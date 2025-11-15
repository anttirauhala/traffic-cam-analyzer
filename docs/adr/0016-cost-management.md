# ADR 0016: Kustannushallinta

- Status: Accepted
- Päivämäärä: 2025-10-24

## Tausta
- Sovellus hyödyntää useita hallittuja AWS-palveluita (S3, DynamoDB, Step Functions, EventBridge, Lambda, SQS, SNS, CloudFront, CloudWatch).
- Tavoitteena on pitää kokonaiskulut alle 10 EUR kuukaudessa kehitys- ja tuotantoympäristöjen yhteenlaskettuna kuluna.
- Aiemmat ADR:t määrittävät ingestin ajastusrytmin (ADR 0006), datan säilytysajan (ADR 0013) ja havainnointiputken komponentit, mutta kustannusten mittaamiseen ja rajaamiseen ei ole vielä prosessia.

## Päätös
- **Budjettiraja**: AWS Budgets -palvelussa luodaan 10 EUR kuukausibudjetti ympäristölle. Budjetti kattaa kaikki palvelut, ja kynnysarvot asetetaan 80 % ja 100 %. Hälytykset lähetetään SNS-kanaviin `TrafficCamOpsAlerts` (ADR 0009) ja sähköpostiin.
- **Kustannusvastuu**: Projektin vastuuhenkilö tarkistaa budjetin toteuman viikoittain ja kvartaalin lopussa. Poikkeamat dokumentoidaan runbookiin.
- **Autoscaling ja rajoitukset**:
  - Step Functionsin ja Lambda-funktioiden samanaikaisuus rajoitetaan: ingest-Lambda max 5, analyysi-Lambda max 5.
  - DynamoDB taulun (ImageDetections) kapasiteetti pidetään On-Demand -tilassa, mutta CloudWatch hälytys triggaa, jos hinta ylittää 3 EUR / kk. Tällöin arvioidaan TTL- ja arkistointikäytännöt (ADR 0013).
  - CloudFrontin tiedonsiirtoa seurataan: hälytys, jos datalähtö ylittää 50 GB / kk.
- **Raportointi**: Terraform/CDK tuottaa Cost Explorer -raportin (CSV) ja tallentaa sen S3:een kerran kuukaudessa (EventBridge Scheduler + Lambda). Raportti visualisoidaan QuickSightissa; dashboard linkitetään runbookiin.
- **Optimointi-askelmat**: Budjettihälytyksen laukaisema analyysi tarkistaa palvelukonfiguraatiot (esim. Lambda-keston optimointi, Step Functions -kutsujen määrän vähentäminen) ja kirjaa säästötoimet backlogiin.

## Perustelut
- Budjetti- ja hälytysrakenne varmistaa, että kustannusraja havaitaan ennen sen ylittymistä ja operaatiotiimi saa tiedon nopeasti.
- Samanaikaisuuden rajaaminen pitää Lambda-kulut hallinnassa ja estää yllättävän laskun piikkien aikana.
- Automaattinen Cost Explorer -raportti antaa läpinäkyvän näkymän palvelukohtaisiin kuluihin ilman manuaalista työtä.

## Vaihtoehdot
- Voitaisiin luottaa pelkkiin kuukausiraportteihin ilman budjettihälytyksiä, mutta se riskeeraisi rajan ylittymisen ennen reagointia.
- Kiinteä DynamoDB kapasiteetti (RCU/WCU) voisi alentaa kustannuksia, mutta sitoo kapasiteettipäätökset etukäteen ja huonontaa elastisuutta.

## Seuraukset
- Budjetin ylittyessä on aktivoitava säästötoimet: esim. ingest-ajastuksen harventaminen, CloudFront TTL:n kasvatus, Lambda-koodin optimointi.
- Operatiivinen prosessi tarvitsee ajantasaisen runbookin, jossa kirjataan päätetyt toimenpiteet, jotta reagointi ei jää henkilömuistin varaan.
- Cost Explorer -raportti lisää pienen Lambda-kulun (sekuntien tasolla), mutta antaa riittävän näkyvyyden budjetin hallintaan.
