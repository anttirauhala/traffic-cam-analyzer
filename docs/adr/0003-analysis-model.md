# ADR 0003: Kuvien analyysimalli

- Status: Accepted
- Päivämäärä: 2025-10-24

## Tausta
- Sovellus etsii eläinhavaintoja DigiTrafficin kelikameroiden kuvista.
- Tarvitaan objektiluokitteluratkaisu, joka tunnistaa useita eläinlajeja ilman oman mallin koulutusta ja ylläpitoa.
- Infrastruktuurin halutaan pysyvän kevyenä, jotta kehitystiimi voi keskittyä ingest- ja hälytyslogiikkaan.

## Päätös
- Hyödynnämme Replicate-palvelun mallia `franz-biz/yolo-world-xl` jokaisen kuvan analysointiin.
- Lambda-funktio kutsuu Replicate API:a HTTP POST -pyynnöllä; API-avain talletetaan AWS Secrets Manageriin ja välitetään ajonaikaisena ympäristömuuttujana.
- Kutsumme mallia aina parametreilla `return_json: true` ja `max_num_boxes: 100`, jotta saamme koneellisesti parsittavan tuloksen ja pidämme bounding boxien määrän hallittuna.
- Mallin tuottama JSON-tuloste (kenttä `json_str`) normalisoidaan backendissä yhdeksi yhteiseksi skeemaksi (ks. `packages/shared`), jota käytetään sekä hälytysten päätöksenteossa että tallennuksessa DynamoDB:hen.

## Perustelut
- `franz-biz/yolo-world-xl` tukee laajaa valikoimaa kohteita (eläimet, ajoneuvot, jalankulkijat) ja soveltuu kelikamerakuvien heterogeenisiin olosuhteisiin.
- Replicate ylläpitää mallin infrastruktuuria, jolloin meidän ei tarvitse hallita GPU-instansseja, autoskaalausta tai päivityksiä.
- Pakottamalla `return_json: true` varmistamme, että tulos sisältää sekä annotoidun kuvan (`media_path`) että JSON-datan jatkokäyttöä ja auditointia varten.
- Käyttö on kustannuksilta ennakoitavaa: analytiikkakulut skaalautuvat suoraan käsiteltyjen kuvien määrän mukaan.
- API-pohjainen malli vähentää deploy-kompleksisuutta; Lambda voi kutsua samaa palvelua kehitys-, testi- ja tuotantoympäristöissä ilman erillisiä deployja.

## Vaihtoehdot
- AWS SageMaker + oma YOLO-malli: hylätty, koska vaatii merkittävästi enemmän DevOps- ja ML-osaamista sekä aiheuttaa jatkuvia kustannuksia (GPU-hostaus, monitorointi).
- Hugging Face Inference Endpoints: hylätty, koska mallivalikoimassa ei ollut vastaavaa valmiiksi koulutettua mallia eläinhavaintoihin ja hinnoittelu oli korkeampi.
- Itse ylläpidetty YOLOv5 kontissa (ECS/EKS): hylätty, koska ylläpito ja skaalaus olisi raskasta pienen tiimin resursseilla.

## Seuraukset
- Secrets Manageriin on luotava Replicate API -avain ja IAM-oikeudet sen lukemiseen analysointia suorittavalle Lambdalle.
- Step Functions -workflow tarvitsee virheenkäsittelyn Replicate-API:n mahdollisia timeoutteja ja rajoitusvirheitä varten (retry + DLQ).
- Mallin versio ja prompt-parametrit on dokumentoitava ja versioitava; muutoksista laaditaan uusi ADR tai päivitetään tämä.
- Kustannusseuranta (AWS Budgets + Replicate-tilasto) on integroitava seurantaan, jotta yllättävät piikit havaitaan.
