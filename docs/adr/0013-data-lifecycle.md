# ADR 0013: Datan elinkaari ja arkistointi

- Status: Accepted
- Päivämäärä: 2025-10-24

## Tausta
- Sovellus tuottaa sekä raakakuvia (S3 `traffic-cam-<env>-wf-raw-bucket`), analysoituja kuvia JSON-annotaatioineen (S3 `traffic-cam-<env>-storage-processed-bucket`) että havaintometadataa (DynamoDB `ImageDetections`).
- Pitkäaikainen säilytys kasvattaa kustannuksia, mutta audit- ja jälkikäyttötarpeet edellyttävät, että dataa ei poisteta heti.
- Tarvitaan selkeä elinkaaripolitiikka, joka määrittää missä vaiheessa data arkistoidaan tai poistetaan.

## Päätös
- **Raakakuvat (`raw-bucket`)**:
  - S3 Lifecycle Rule: siirretään Glacier Flexible Retrieval -tasolle 90 päivän jälkeen.
  - Poistetaan kokonaan 365 päivän jälkeen, ellei metadatassa ole flagia `archivalRequired=true`.
- **Analysoidut kuvat + JSON (`processed-bucket`)**:
  - Pidetään Standard-tilassa 180 päivää.
  - Siirretään sen jälkeen Glacier Instant Retrieval -tasolle (halvempi, mutta nopea haku).
  - Poistetaan 540 päivän jälkeen, ellei `archivalRequired=true`.
- Lambdat kirjoittavat `archivalRequired`-tagin S3-objektien metadataan ja DynamoDB-itemiin, jos havainto aiheutti hälytyksen (eläin/ihminen). Tällaiset kohteet säilytetään pidempään manuaalista auditointia varten.
- **DynamoDB `ImageDetections`**:
  - Ei käytetä TTL:ää oletuksena; data säilyy toistaiseksi. Tarvittaessa vanhat havainnot voidaan arkistoida S3:een (Parquet/JSON) erillisellä backfill-jobilla ja poistaa DynamoDB:stä.
  - Lisätään attribuutti `expiresAtEpoch` (nullable). Jos määritetään, Step Functions voi asettaa TTL:n (esim. 730 päivän päähän) ja DynamoDB poistaa rivin.
- **Audit trail**: Hälytyksen saaneiden kuvien ja metadatan poistaminen edellyttää manuaalista hyväksyntää. Tätä varten runbookissa määritellään prosessi (`archivalRequired` flag poistetaan → lifecycle poistaa objektin seuraavassa ajossa).

## Perustelut
- Glacier-taso vähentää kustannuksia merkittävästi, mutta säilyttää mahdollisuuden hakea dataa auditointia tai raportointia varten.
- `archivalRequired`-flag mahdollistaa priorisoidun säilytyksen hälytystapauksille (joita todennäköisesti tutkitaan myöhemmin).
- Delfinaarinen TTL DynamoDB:ssa jättää mahdollisuuden historialliseen analyysiin; TTL voidaan ottaa käyttöön myöhemmin ilman schema-muutoksia.
- Lifecycle-säännöt toteutetaan CDK:ssa infrastruktuurina, joten ne pysyvät versionhallinnassa eikä manuaalista konfigurointia tarvita.

## Vaihtoehdot
- Säilyttää kaikki data Standard-tilassa ilman lifecyclea: hylätty kustannussyistä.
- Poistaa raakakuvat välittömästi analyysin jälkeen: hylätty, koska auditointia ja uudelleenanalysointia saatetaan tarvita (esim. mallin päivitys).
- Arkistoida DynamoDB-data automaattisesti TTL:llä 180 päivän jälkeen: hylätty tässä vaiheessa, koska raportointi ja trendianalyysi hyötyvät pitkästä historiasta.

## Seuraukset
- CDK:ssa lisätään lifecycle-säännöt molempiin bucketteihin ja varmennetaan, että `archivalRequired=true` estää poistot (käytetään `Filter` + `Tag` -pohjaisia sääntöjä).
- Lambda-koodi päivitetään kirjoittamaan S3-tagit ja DynamoDB-attribuutit (sekä runbook ohjeistaa, miten flagit poistetaan tarvittaessa).
- Kustannusseuranta: CloudWatch/Budgets seuraa Glacier-kustannuksia, jotta tiedetään, paljonko arkistointi maksaa.
- Audit-prosessi dokumentoidaan: kuka saa poistaa `archivalRequired`-flagin ja miten muutokset kirjataan (esim. SNS-ilmoitus).
