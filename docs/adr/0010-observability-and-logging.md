# ADR 0010: Observability ja lokitus

- Status: Accepted
- Päivämäärä: 2025-10-24

## Tausta
- Ingest- ja analyysiputki koostuu useista Lambda-funktioista, Step Functions -tilakoneesta ja SQS-jonosta. On varmistettava, että virheet, suoritusmäärät ja hälytykset ovat näkyvissä ilman raskasta ulkoista APM-ratkaisua.
- Business-tiimi haluaa tietää analysoitujen kuvien ja lähetettyjen hälytysten määrän päivittäin, ja ylläpito seuraa mahdollisia virheitä tai viiveitä.

## Päätös
- Hyödynnämme AWS CloudWatchia ensisijaisena observability-alustana. Kaikki Lambdat ja Step Functions käyttävät structured logging -formaattia (JSON) ja kirjoittavat CloudWatch Logsiin.
- Analysoitujen kuvien, eläinhavaintojen, ihmishavaintojen ja lähetettyjen hälytysten määrät julkaistaan custom-metriikkoina CloudWatchiin Namespaceen `TrafficCam/Analytics`:
  - `ImagesAnalyzed` (dimensions: `Environment`, `CameraId`)
  - `WildlifeDetections` (dimensions: `Environment`, `CameraId`, `Species`)
  - `PersonDetections` (dimensions: `Environment`, `CameraId`)
  - `AlertsSent` (dimensions: `Environment`, `CameraId`, `AlertType`)
- Lambda `AnalyzeImage` kasvattaa `ImagesAnalyzed`-metriikkaa yhdellä jokaisesta onnistuneesta analyysistä (myös niistä, joissa ei havaita eläimiä/ihmisiä).
- Jos analyysissä havaitaan eläimiä, Lambda kasvattaa lisäksi `WildlifeDetections`-metriikkaa (dimension `Species` per löydetty luokka). Ihmishavainnoista kasvatetaan `PersonDetections`-metriikkaa.
- SNS-lähetyksistä (topic `TrafficCamAlerts`) kirjoitetaan CloudWatch Metric Filter, joka kasvattaa `AlertsSent`-metriikkaa. Lisätään lambdaan myös eksplisiittinen `PutMetricData`-kutsu, jotta hälytykset näytetään reaaliaikaisesti.
- Rakennetaan CloudWatch Dashboard, joka näyttää:
  - Tunnittaiset `ImagesAnalyzed`-summat (rolling 24 h)
  - Tunnittaiset `WildlifeDetections`- ja `PersonDetections`-summat
  - Tunnittainen `AlertsSent`-summa (jaon per `AlertType`)
  - Step Functions `ExecutionsFailed`, SQS DLQ depth ja `ImageAnalysisQueue`-jonon nykyinen pituus
- Hälytykset virhetapauksille (esim. Step Functions failure > 0, SQS DLQ depth > 0) julkaisevat viestin `TrafficCamOpsAlerts`-topiciin (ADR 0009).

## Perustelut
- CloudWatch tarjoaa natiivin integraation AWS-palveluiden kanssa, eikä edellytä lisäagentteja tai kustannuksia pienen liikennemäärän skenaariossa.
- Structured logging (JSON) helpottaa logien suodatusta ja mahdollistaa tulevien laajennusten (esim. Kibana) ilman muutoksia.
- Custom-metriikat antavat yksinkertaisen tavan raportoida business-lukuja ilman erillistä tietovarastoa.
- Dashboard tarjoaa nopean näkymän seurannan tarpeisiin; CloudWatch Console riittää alkuvaiheen raportointiin.

## Vaihtoehdot
- Kolmannen osapuolen observability-työkalut (Datadog, New Relic): hylätty MVP-vaiheessa kustannus- ja ylläpitovelan takia.
- OpenTelemetry + kehityskeskeinen analytiikka: hylätty toistaiseksi, koska data on rajattua ja CloudWatch riittää.
- Ei custom-metriikoita, pelkät lokit: hylätty, koska raportoinnin rakentaminen pelkistä lokeista olisi työlästä ja hidas.

## Seuraukset
- CDK:ssa luodaan CloudWatch Dashboard ja määritetään metric filter SNS-topiciin. Lambdoihin lisätään `PutMetricData`-kutsut.
- Logitus toteutetaan yhteisellä loggeri-halpperilla (`packages/shared/logging`), joka lisää kontekstin (cameraId, requestId, state machine executionId).
- Lokien retention määritetään 30 päivään (muokattavissa environment-kohtaisesti); vanhemmat lokit poistuvat automaattisesti kustannusten hallitsemiseksi.
- CloudWatch-alarmeille määritellään kynnysarvot (esim. `ImagesAnalyzed` < odotettu minimitaso) ja varmistetaan, että ne eivät aiheuta turhia hälytyksiä (esim. yöllä ei liikennettä).
- Dashboardin ylläpito ja mahdollinen laajennus (esim. liikenteen visualisointi) kirjataan runbookissa; laajempia raportointitarpeita varten voidaan myöhemmin viedä metriikat esim. QuickSightiin.
