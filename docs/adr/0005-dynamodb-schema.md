# ADR 0005: DynamoDB-skeema analyysituloksille

- Status: Accepted
- Päivämäärä: 2025-10-24

## Tausta
- Jokainen ingest-sykli tuottaa useita havaintoja: kameran metatiedot, raakakuvan S3-avaimen, analyysin tulokset ja mahdolliset hälytykset.
- Tarvitaan nopeasti haettavissa oleva tietovarasto, josta frontend voi hakea viimeisimmät tulokset ja backend arvioida hälytyskriteerit.
- Replicate-malli `franz-biz/yolo-world-xl` palauttaa JSON-merkintöjä (bounding boxit ja luokat) myös ihmisistä ja ajoneuvoista; tiedot pitää versioida ja säilyttää hakua varten.

## Päätös
- Luomme kaksi DynamoDB-taulua:

### ImageDetections-taulu
- Pääavain:
  - Partition key `cameraId` (string)
  - Sort key `capturedAtEpoch` (number, UTC-ajan sekunnit epochista)
- Jokainen item edustaa yksittäistä kamerakuvaa ja sen analyysitulosta.
- Tallennettavat attribuutit:
  - `rawImageKey` (string) – viite S3 `traffic-cam-raw` -bucketin objektiin.
  - `processedImageKey` (string | null) – viite `traffic-cam-processed` -bucketin kuvaan (voi puuttua, jos analyysi epäonnistui).
  - `replicateJobId` (string) – Replicate-ajon tunniste auditointiin.
  - `capturedAt` (string) – ihmisen luettava aikaleima (esim. `24.10.2025 18:42:15`).
  - `replicateInput` (map) – normalisoitu syöte: `classNames`, `scoreThreshold`, `nmsThreshold`, `maxNumBoxes`, `returnJson` (aina `true`), `inputMedia`.
  - `replicateOutput` (map) – mallin vastauksen JSON-parsittu sisältö (kentästä `json_str`) sovelluksen skeemassa.
  - `hasWildlife` (boolean) – true, jos `replicateOutput` sisältää eläinluokkia.
  - `hasPerson` (boolean) – true, jos `replicateOutput` sisältää ihmisluokkia.
  - `detectedClasses` (list<string>) – distinct-luokat (esim. `deer`, `moose`, `person`).
  - `detectionCount` (number) – montako kohdetta mallin mukaan löytyi.
  - `alertSent` (boolean) ja `alertChannel` (string | null) – dokumentoidaan, lähetettiinkö hälytys (SNS/SES).
  - `processingStatus` (string enum: `SUCCESS`, `FAILED`, `SKIPPED`).
  - `failureReason` (string | null) – virheloki.
- GSI-indeksit:
  - `hasWildlife-capturedAtEpoch-index` (partition key `hasWildlife` string, sort key `capturedAtEpoch` number)
  - `hasPerson-capturedAtEpoch-index` (partition key `hasPerson` string, sort key `capturedAtEpoch` number)

### Cameras-taulu
- Pääavain:
  - Partition key `cameraId` (string)
- Attribuutit:
  - `name` (string) – kameran nimi muodossa "Asema - Preset"
  - `municipality` (string) – kunta
  - `lat` (number) – leveysaste
  - `lon` (number) – pituusaste
  - `latestCaptureEpoch` (number) – viimeisin kuvan ottohetki
  - `updatedAt` (number) – taulun päivitysaika epoch

## Perustelut
- `cameraId` + `capturedAtEpoch` muodostaa luonnollisen avaimen, koska kamerat tuottavat kuvia kronologisesti; numeerinen sorttaus mahdollistaa tehokkaat range-kyselyt ilman string-vertailun rajoitteita.
- DynamoDB tarjoaa matalan viiveen lukemisen ja kirjoittamisen ilman infrastruktuurin ylläpitoa, sopii ingestin vaatimaan skaalautuvuuteen.
- Tallentamalla Replicate-syötteen ja -vastauksen metatiedot samaan itemiin varmistamme jäljitettävyyden (mitkä parametrit → mikä tulos), mikä on tärkeää modellin päivityksen ja debuggaamisen kannalta.
- GSI `gsiHasWildlife` palvelee hälytysten jatkokäsittelyä ja raportointia; `processingStatus` auttaa monitoroinnissa.
- JSON-rakenteen normalisointi `packages/shared` -paketin skeemaan tekee frontendin ja backendin välisestä sopimuksesta selkeän ja tyypitetyn.

## Vaihtoehdot
- OpenSearch / Elastic: hylätty, koska ylläpito ja kustannus olisivat suuremmat ja query-tarve on suhteellisen yksinkertainen.
- RDS (PostgreSQL): hylätty tällä volyymilla; relaatiomalli olisi ylimitoitettu ja vaatisi enemmän operatiivista työtä.
- Tallennus pelkästään S3 JSON -tiedostoihin: hylätty, koska hakukyselyt (esim. “näytä viimeiset 50 havaintoa eläimistä”) olisivat hitaita ilman erillistä indeksiä.

## Seuraukset
- CDK:ssa tarvitaan taulun määrittely, kapasiteetin (on-demand) valinta ja IAM-oikeudet ingest- ja API-Lambdoille.
- `packages/shared` -paketissa kuvataan TypeScript-tyypit ja Zod-skeemat DynamoDB-itemille; nämä rajapinnat ohjaavat myös API Gatewayn vastauksia.
- Step Functions / Lambda -koodi vastaa `replicateOutput` -mapin normalisoinnista (JSON-parsinta `json_str` -kentästä), aikaleimojen tallentamisesta (`capturedAtEpoch` + lokalisoitu `capturedAt`) sekä `media_path` -viitteen tallettamisesta `processedImageKey`-attribuuttiin.
- Jos Replicate palauttaa vastauksen ilman `json_str`-kenttää, item merkitään `processingStatus = FAILED` ja `failureReason` kuvaa puuttuvaa JSON-dataa.
- Datan elinkaari: DynamoDB pitää säilyttää pitkään (ei TTL:ää oletuksena); jos vanhat havainnot halutaan arkistoida, lisätään TTL-attribuutti ja S3-arkistointiprosessi myöhemmin omaan ADR:ään.
- Monitorointi: CloudWatch-metriikat (successful read/write, throttling) ja Contributor Insights -säännöt täytyy ottaa käyttöön, jotta kuormitus piikit havaitaan.
