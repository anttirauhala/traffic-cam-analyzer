# ADR 0006: Ingest- ja analyysityönkulku AWS:ssa

- Status: Accepted
- Päivämäärä: 2025-10-24

## Tausta
- Sovellus hakee kelikamerakuvat muunnettuun aikaväliin (2x tunnissa) ja analysoi ne automaattisesti ilman manuaalisia käynnistyksiä.
- Työnkulun täytyy hallita useita vaiheita: kameralistan haku, kuvien lataus, jonotus analyysille, Replicate-kutsu, tulosten tallennus ja hälytysten lähetys.
- Prosessin on oltava virheensietoinen, ajastettavissa, ja sen pitää rajoittaa rinnakkaisten analyysien määrää kustannusten hallitsemiseksi.

## Päätös
- Ajastus toteutetaan Amazon EventBridge Scheduler -palvelulla, joka laukaisee työnkulun joka tunti klo 09:00-16:00 (Helsinki) kutsumalla `FetchCameraList` Lambdaa.
- Työnkulku toteutetaan event-driven-arkkitehtuurilla EventBridge + SQS -pohjaisesti (ei Step Functions):
  1. `FetchCameraList` Lambda hakee `https://tie.digitraffic.fi/api/weathercam/v1/stations` -rajapinnasta kamerat, suodattaa ne 30 km säteelle Tampereesta ja julkaisee jokaisen kameran `CameraFetched`-eventin EventBridgeen.
  2. EventBridge-sääntö `CameraFetchedRule` ohjaa `CameraFetched`-eventit SQS-jonoon `DownloadQueue`.
  3. `DownloadImage` Lambda triggeroituu SQS-jonosta (batch size 10), lataa kuvat S3 `traffic-cam-raw` -bucketiin ja julkaisee `ImageDownloaded`-eventin EventBridgeen jokaisesta onnistuneesta latauksesta.
  4. EventBridge-sääntö `ImageDownloadedRule` ohjaa `ImageDownloaded`-eventit SQS-jonoon `AnalysisQueue`.
  5. `AnalyzeImage` Lambda triggeroituu SQS-jonosta (batch size 10) ja:
     - Generoi Replicate-kutsun (parametrit `return_json: true`, `max_num_boxes: 100`).
     - Odottaa tuloksen, tallentaa annotation-kuvan `traffic-cam-processed` -bucketiin ja kirjoittaa `ImageDetections`-tauluun.
     - Jos havaitaan eläin tai ihminen, julkaisee viestin SNS-topiciin `TrafficCamAlerts`.
- Kummallakin SQS-jonolla on oma DLQ (`DownloadDLQ`, `AnalysisDLQ`) virheellisiä viestejä varten. Lambda-retrylogiikka perustuu SQS:n sisäänrakennettuun `maxReceiveCount`-asetukseen (3 yritystä).
- `AnalyzeImage` Lambda on rajoitettu 1 concurrent execution -asetuksella Replicate API rate limiting -vaatimusten takia.
- Kaikki Lambda-funktiot on kirjoitettu TypeScriptillä ja bundlataan esbuildillä; jokaisella on rajatut IAM-oikeudet (least privilege).

## Perustelut
- EventBridge Scheduler poistaa tarpeen ylläpitää omaa cron-Lambdaa ja tarjoaa keskitetyn ajastuksen hallinnan.
- EventBridge + SQS event-driven-arkkitehtuuri on **7× halvempi** kuin Step Functions (~$0.53/kk vs ~$3.60/kk) ja skaalautuu automaattisesti ilman Map-tilan transition-kustannuksia.
- SQS-jonot irrottavat vaihee

t toisistaan: ingest voi jatkaa vaikka analyysi hidastuisi, ja concurrency hallitaan Lambda event source mapping -asetuksilla.
- Lambda + S3 sopii hyvin burst-malliseen kuvanlataukseen ilman pysyvää palvelinta; TypeScript mahdollistaa jaetun koodin käytön monorepossa.
- DLQ ja CloudWatch-metriikat takaavat, että epäonnistuneet käsittelyt eivät katoa ja niihin voidaan reagoida jälkikäteen.

## Vaihtoehdot
- AWS Step Functions -pohjainen orkestrointi: hylätty kustannussyistä (7× kalliimpi kuin EventBridge+SQS), vaikka tarjoaa paremman näkyvyyden ja keskitetyn virheidenhallinnan.
- AWS Batch / Fargate -pohjainen prosessointi: hylätty, koska kustannukset ja hallinta olisivat raskaampia pienelle kuormalle.
- Kinesis Data Streams ingestissä: hylätty, koska nykyinen ingest-tahti (1x tunnissa) ei edellytä jatkuvaa streamausta.

## Seuraukset
- CDK-projektissa on määriteltävä EventBridge Scheduler -sääntö, EventBridge-säännöt (`CameraFetchedRule`, `ImageDownloadedRule`), SQS-jonot (`DownloadQueue`, `AnalysisQueue` + DLQ:t), SNS-topic `TrafficCamAlerts` ja tarvittavat Lambda-funktiot event source mappingeineen.
- IAM-roolit pitää määritellä tarkasti: esim. `FetchCameraList` saa julkaista EventBridgeen; `DownloadImage` saa lukea SQS:sta, kirjoittaa S3:een ja julkaista EventBridgeen; `AnalyzeImage` saa lukea SQS:sta, Secrets Managerista Replicate-avaimen ja kirjoittaa DynamoDB:hen.
- Lambda event source mappingin `batchSize` (10) ja `maxConcurrency` -asetukset säädetään vastaamaan kuormaa ja Replicate-API:n vasteaikoja.
- CloudWatch-loggerointi ja metriikat (Lambda errors, SQS DLQ depth, EventBridge failed invocations) on kytkettävä hälytyksiin (SNS/Slack).
- Dokumentoidaan runbook: miten ingest pysäytetään (disable scheduler), miten DLQ puretaan ja miten epäonnistuneet käsittelyt replayataan (SQS redrive).
