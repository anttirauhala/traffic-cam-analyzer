# ADR 0015: Tietoturva ja identiteetti

- Status: Accepted
- Päivämäärä: 2025-10-24

## Tausta
- Mikropalvelut ja ingest-ketju toimivat AWS:ssä ilman julkisia avointa käyttöoikeutta; pääsy tapahtuu API Gatewayn ja CloudFrontin rajapintojen kautta.
- REST API vaatii API-avaimen (ADR 0007), ja UI on julkinen read-only (ADR 0002, ADR 0014).
- Edellytetään selkeät IAM-rajaukset, salaisuuksien hallinta ja suojakerrokset, jotka estävät luvattoman pääsyn kamerahavaintojen dataan ja Replicate-mallin tunnuksiin.

## Päätös
- **Identiteetti ja valtuutus**
  - Infrastruktuuri käyttää erillisiä IAM-rooleja CDK-stackien mukaan: `WorkflowRole`, `StorageRole`, `ApiRole`, `FrontendRole`, `MonitoringRole`. Jokainen rooli saa ainoastaan tarvitsemansa resurssioikeudet (least privilege).
  - Lambda-funktiot käyttävät palvelukohtaisia rooleja, joissa on mukautetut policyt (esim. ingest-Lambda saa `dynamodb:PutItem` vain `ImageDetections`-tauluun).
  - GitHub Actions deploy -roolit määritellään AWS OIDC trust policyssä (ADR 0011). Työnkulut noutavat väliaikaiset tunnukset vain tarpeellisille stackeille.
- **Rajapintojen suojaus**
  - API Gateway edellyttää API-avainta. Avaimen arvo asuu AWS Secrets Managerissa ja injektoidaan CloudFrontiin build-vaiheessa (ADR 0014).
  - CloudFront WAF käyttää hallittuja sääntösarjoja (AWS Managed Rules) sekä kustomoitua IP-allowlistia admin-työkaluille (tarvittaessa).
  - API Gatewayssä on request throttling: 100 req/min per avain, jotta brute-force-yritykset eivät kuormita ingest-taustaa.
- **Salaisuudet ja konfiguraatio**
  - Replicate API -token sekä REST API -avaimet säilytetään Secrets Managerissa. Käyttö oikeutetaan vain niille rooleille, jotka tarvitsevat salaisuuksia (esim. ingest-Lambda, API build pipeline).
  - Parametrisoitu konfiguraatio (esim. kamerakohtaiset suppressiot) pysyy SSM Parameter Storessa salattuna `SecureString`-tyyppinä.
  - Kaikki salaisuudet ja parametrit kierrätetään manuaalisesti vähintään neljännesvuosittain ja aina kun vuotoepäily (ADR 0008). Kierrätys prosessin jälkeen julkaistaan uusi frontti ja API-avaimet.
- **Tietoliikenteen suojaus**
  - Kaikki REST-kutsut kulkevat HTTPS:n yli. CloudFront pakottaa HSTS-headerit, ja TLS versio on vähintään 1.2.
  - Intra-AWS liikenne (S3, DynamoDB, SQS, SNS) käyttää palvelukohtaisen salauksen oletuksia (SSE-S3, SSE-SNS, SSE-SQS). DynamoDB:ssä on default KMS-salaus projektin avaimella.
- **Auditointi ja valvonta**
  - AWS CloudTrail on päällä kaikissa tileissä; lokit toimitetaan keskitettyyn S3-buckettiin ja CloudWatch Logsiin 365 päivän säilytyksellä.
  - CloudWatch metrikoille (ADR 0010) lisätään varoitus API-avaimen väärinkäyttöön: jos hylättyjen pyyntöjen määrä ylittää 100/h, SNS ilmoittaa ops-tiimille.
  - IAM Access Analyzer tarkistaa viikoittain, ettei rooleille ole annettu odottamattomia ulkoisia luottosuhteita.

## Perustelut
- Least privilege -politiikka rajoittaa vahinkoa, jos yksittäinen Lambda kompromettoituu.
- API-avaimeen perustuva read-only rajapinta on kevyt ratkaisu, koska käyttäjät eivät tarvitse kirjautumista ja ingest-data ei sisällä henkilötietoja.
- Secrets Manager tarjoaa versionoinnin ja audit loggingin, jolla voidaan jäljittää salaisuuden käyttötilanteet.
- WAF ja throttlaus torjuvat automaattiset hyökkäysyritykset ennen kuin ne tavoittavat API-lambdat.

## Vaihtoehdot
- Cognito tai toinen identiteettipalvelu olisi voinut tarjota OAuth/OIDC-tunnistautumisen, mutta UI on julkinen eikä sisällä muokkaustoimintoja.
- JWT-pohjainen auth kerros API-avaimen sijaan; hylättiin, koska se vaatisi käyttäjätilien hallintaa ilman liiketoiminta-arvoa.
- Salaisuuksien tallentaminen Parameter Storeen sijaan Secrets Managerin käyttö; Secrets Manager valittiin auditointi- ja rotaatiotuen vuoksi.

## Seuraukset
- On ylläpidettävä IAM-roolien ja policyjen dokumentaatiota, jotta least privilege pysyy ajan tasalla.
- API-avaimen kierrätys aiheuttaa frontin rebuildin ja CloudFront-invalidaation; pipeline automatisoi toimenpiteen.
- WAF-sääntöjen päivitys ja allowlistien hallinta vaativat operatiivisia prosesseja (muutospyynnöt, testaus ennen tuotantoa).
- Security-tiimin on ajettava säännölliset penetraatiotestit ja katselmoitava CloudTrail-havainnot osana runbookia (ADR 0009).
