# ADR 0009: Hälytyspolitiikka ja ilmoituskanavat

- Status: Accepted
- Päivämäärä: 2025-10-24

## Tausta
- Analyysiputki havaitsee eläimiä ja ihmisiä kelikamerakuvissa. Eläinhavainnot (ja tarvittaessa tietyt ihmishavainnot) tulee välittää tilaajille nopeasti sähköpostitse.
- Hälytysjärjestelmän tulee olla laajennettavissa muihin kanaviin (esim. Slack, SMS) ja hallittava tilaajalistat ilman koodimuutoksia.
- Tarvitaan myös operatiiviset hälytykset ingestin virheistä (esim. Step Functions epäonnistuu, SQS DLQ kasvaa), jotta ylläpito reagoi vikatilanteisiin.

## Päätös
- Käytämme AWS SNS:ää pääasiallisena viestinjakelukanavana. Luodaan topic `TrafficCamAlerts`, johon tilaajat (sähköposti) rekisteröityvät.
- `AnalyzeImage` Lambda julkaisee `ImageAnalyzed`-eventin EventBridgeen jokaisen onnistuneen analyysin jälkeen.
- EventBridge-sääntö suodattaa eventit joissa `detectionCount > 0` ja ohjaa ne `SendAlert` Lambda-funktiolle.
- `SendAlert` Lambda muotoilee hälytysviestiin: kameran nimen, kuvan aikaleiman, havaitut luokat (eläin/ihminen), detection countin ja yhteenvedon tunnistetuista luokista.
- Viesti lähetetään SNS-topiciin `TrafficCamAlerts` sähköpostille.
- SNS:n tilaushallinta: ylläpitäjä hallinnoi listaa AWS Console/API kautta. Laajennus muihin kanaviin (Slack webhook, SMS) onnistuu lisäämällä uusia subscription-tyyppejä samaan topiciin.
- Operatiiviset hälytykset toteutetaan CloudWatch Alarmeilla, jotka lähettävät ilmoituksen erilliseen SNS-topiciin `TrafficCamOpsAlerts` (esim. Step Functions `ExecutionsFailed`, SQS DLQ depth, Lambda error rate, Replicate API error count).

## Perustelut
- SNS tarjoaa yksinkertaisen, skaalautuvan tavan toimittaa ilmoituksia useaan kanavaan ilman omaa viestisovellusta. Sähköposti on suoraan tuettu ja tilausten hallinta on helposti auditoinnin piirissä.
- Eriyttämällä business-hälytykset (`TrafficCamAlerts`) ja operatiiviset hälytykset (`TrafficCamOpsAlerts`) varmistetaan, etteivät käyttäjät saa sisäisiä virheilmoituksia ja ylläpito saa nopeasti oikean signaalin.
- Viestin payload-malli on yhdenmukainen frontendin kanssa (käytetään samoja `packages/shared` -tyyppejä), joten viestit voivat toimia myös audit trailina.
- Parameter Store -pohjainen suppressio joustavoittaa hallintaa: perustellaan per kamera, mitkä havainnot triggaavat viestin.

## Vaihtoehdot
- SES suora lähetys ilman SNS:ää: hylätty, koska tilaajahallinta ja kanavien laajennettavuus olisi työläämpää.
- Erillinen queue + worker -pohjainen ilmoituspalvelu: hylätty MVP-vaiheessa; SNS riittää nykyiseen tarpeeseen.
- Sekoitettu topic yhdistettynä ops- ja business-hälytyksille: hylätty, koska eri kohderyhmien signaalit sekoittuisivat.

## Seuraukset
- CDK:ssa määritellään kaksi SNS-topiccia (Alerts ja Ops) ja tarvittavat IAM-oikeudet Lambdoille julkaista viestejä.
- Viestiformaatit dokumentoidaan `packages/shared` -moduulissa, jotta sekä backendin lähetys että mahdolliset kuluttajat (frontend, raportointi) käyttävät samaa schemaa.
- Ylläpitodokumentaatioon lisätään ohjeet tilaajien lisäämisestä/poistamisesta sekä suppressioasetusten muuttamisesta.
- CloudWatch Alarmin kynnysarvot (esim. DLQ > 0, Step Functions failure count) on määriteltävä ja testattava staging-ympäristössä.
- Jos tulevaisuudessa tarvitaan “quiet hours” tai priorisointi, SNS-viestit voidaan ohjata esimerkiksi EventBridge’en tai AWS Chatbotiin – tällöin päivitetään tämä ADR.
