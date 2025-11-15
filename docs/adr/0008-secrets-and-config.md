# ADR 0008: Salaisuuksien ja konfiguraation hallinta

- Status: Accepted
- Päivämäärä: 2025-10-24

## Tausta
- Ingest- ja analyysiputki tarvitsee useita salaisuuksia: Replicate API -avain, CloudFront signed URL -avainpari, API Gateway -avaimet sekä mahdolliset DigiTrafficin rajapinta-avaimet.
- Lisäksi kamerakohtaiset konfiguraatiot (esim. ihmishavaintojen suppressio) pitää voida muuttaa ilman koodideployta.
- Ratkaisun tulee tukea kehitys-, testi- ja tuotantoympäristöjä sekä integroitua automatisoituihin deployihin (GitHub Actions).

## Päätös
- Kaikki salaisuudet tallennetaan AWS Secrets Manageriin. Jokaiselle salaisuudelle luodaan erillinen secret (esim. `traffic-cam/replicate-api-key`, `traffic-cam/cloudfront-key`), ja versiotunnisteet dokumentoidaan.
- Sovelluksen konfiguraatiot (kamerakohtaiset suppressioasetukset, alueen rajausparametrit, API:n throttle-rajat) säilytetään AWS Systems Manager Parameter Storessa hierarkkisella nimikkeistöllä (esim. `/traffic-cam/${env}/cameras/{cameraId}/suppress-person`).
- Lambdat lukevat Secrets Managerin salaisuudet runtime-aikana ja cachettavat ne lyhytaikaisesti (esim. 5 minuutin välein), jotta rajoitamme API-kutsuja. Parameter Storesta tulevat asetukset voidaan hakea joko cold startissa tai Step Functions -vaiheessa ja tallentaa memory-cacheen suorituksen ajaksi.
- GitHub Actions hakee deploymentissa kaikki tarvittavat salaisuudet `aws secretsmanager get-secret-value` -komennolla ja injektoi ne buildin environment-muuttujiksi (esim. `VITE_API_KEY`). Ympäristökohtaiset secret-id:t määritellään workflow:n inputteihin.
- Replicate API -avainta ei voi kierrättää suoraan AWS:n rotaatioautomatiikalla, joten rotaatio tehdään manuaalisesti 90 vrk välein Replicaten hallintaliittymästä/CLI:stä ja uusi arvo päivitetään Secrets Manageriin uutena versiona.
- CloudFront key pair vaihdetaan manuaalisesti ylläpitoprosessin kautta (avainpari talletetaan Secrets Manageriin ja vanha poistetaan).

## Perustelut
- Secrets Manager tarjoaa natiivin integraation IAM:iin, rotaatioihin ja audit-lokeihin, mikä helpottaa turvakontrolleja verrattuna custom- tai tiedostoihin.
- Parameter Store (Advanced-tier) sopii muuttumattomalle konfiguraatiolle ja tukee versiointia; erotamme salaisuudet ja ei-salaiset asetukset selkeyden vuoksi.
- Runtime-luku vähentää tarvetta embeddata salaisuuksia deploy-artifakteihin ja mahdollistaa nopean avaimen vaihtamisen ilman redeployta (esim. Replicate avain kierrätys).
- CI:n kautta haettu API-avaimen injektointi (frontendiin) on yksinkertainen, koska se on read-only; Secrets Manager varmistaa, että arvo pysyy yhtenäisenä eri ympäristöissä.
- Hierarkkinen Parameter Store -rakenne tekee kamerakohtaisesta konfiguraatiosta helposti hallittavaa ja tukee infrastruktuurin IaC-malleja (CDK asettaa defaultit, ylläpitäjät voivat ylikirjoittaa).

## Vaihtoehdot
- Salaisuuksien tallentaminen SSM Parameter Storeen: hylätty, koska Secrets Manager tarjoaa valmiit rotaatiot ja hienojakoisemman auditoinnin.
- Salaisuuksien hardkoodaus Lambda environment-muuttujiksi: hylätty turvallisuusriskien ja hitaiden rotaatioiden vuoksi.
- Config-tiedostojen pitäminen S3:ssa: hylätty, koska IAM-politiikat monimutkaistuvat ja versiohallinta on hankalampaa.

## Seuraukset
- CDK:ssa pitää määritellä Secrets Manager -secretit ja Parameter Store -parametrit (oletusarvot). Lambdoille myönnetään minimitason `GetSecretValue` ja `GetParameter` -oikeudet.
- Ylläpitoprosesseihin lisätään ohjeet avaimen rotaatiosta: Replicate -> automaattinen rotaatio webhookilla; CloudFront -> manuaalinen vaihto ja edellinen avain poistetaan.
- Lambdojen cold start -poluissa on otettava huomioon secrets- ja parameter-hakujen latenssi; tarvittaessa käytetään rinnakkaista hakua tai warm-up -mekanismia.
- GitHub Actions -workflow tarvitsee AWS-oikeudet (OIDC + IAM role) Secretien lukemiseen. Audit-logit seuraavat kaikkia lukuja.
- Parameter Store -asetusten muutoksista (esim. suppressiot) voisi lähettää SNS-hälytyksen, jotta ingest oppii muutoksista ilman viivettä; tämä dokumentoidaan runbookissa.
