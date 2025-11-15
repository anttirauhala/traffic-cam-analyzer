# ADR 0012: Infra-nimeämiskäytäntö

- Status: Accepted
- Päivämäärä: 2025-10-24

## Tausta
- AWS-resurssien nimeäminen vaikuttaa hallittavuuteen, kustannusseurantaan ja debuggaamiseen. Monorepossa CDK luo useita stackeja (Workflow, Storage, API, Frontend, Monitoring), ja jokainen stack luo useita resursseja (S3-bucketit, Lambdat, SQS-jonot, SNS-topic). Ilman yhtenäistä nimeämistä resurssien tunnistaminen on vaikeaa eri ympäristöissä.
- Ympäristöjä on kaksi (dev ja prod). Nimet on voitava erottaa selkeästi, jotta virheen sattuessa tiedetään, mihin ympäristöön resurssi kuuluu.

## Päätös
- Nimeämiskäytäntö: `<project>-<env>-<stackId>-<resourceName>`.
  - `project`: kiinteä prefiksi `traffic-cam`
  - `env`: `dev` tai `prod`
  - `stackId`: CDK-stackin lyhyt tunniste (esim. `wf`, `storage`, `api`, `front`, `mon`)
  - `resourceName`: kuvaava resurssin nimi (esim. `raw-bucket`, `analysis-queue`, `alerts-topic`)
- CDK-stackin logical ID: `TrafficCam<StackName>` (esim. `TrafficCamWorkflowStack`), mutta fyysiset resurssit käyttävät yllä kuvattua stringiä.
- Jokainen stack määrittelee oman `resourcePrefix`-funktion, joka liitetään. Esim. WorkflowStackissa: `const prefix = `traffic-cam-${env}-wf`; const queueName = `${prefix}-analysis-queue`;`, FrontendStackissa `traffic-cam-${env}-front`.
- IAM-roolien ja policyjen nimet noudattavat samaa kaavaa, ja rooleihin liitetään tagi `StackId=<stackId>`.
- Log groupit ja CloudWatch dashboardit käyttävät samaa nimeämistä (esim. `/aws/lambda/traffic-cam-dev-wf-analyze-image`).

## Perustelut
- Yhtenäinen kaava helpottaa AWS Console -hakua ja CloudTrail/CloudWatch -lokeista johtamista. Kun resurssin nimi sisältää sekä ympäristön että stackin, virheen lähde on selkeä.
- Stack-kohtaiset tunnisteet (`wf`, `api`) tekevät nimistä lyhyempiä kuin koko stack-nimen toisto ja estävät nimen pituusrajojen (esim. SQS queue name 80 merkkiä) ylityksen.
- Prefixien kautta voidaan myöhemmin rakentaa kustannusallokaatio (Cost Explorerissa `resource tagging`), koska kaikilla resursseilla on sama `project` + `env` alku.

## Vaihtoehdot
- CDK:n automaattinen nimeäminen: hylätty, koska nimet ovat satunnaisia ja vaikeasti luettavia.
- Nimeäminen ilman stack-tunnistetta (vain `traffic-cam-<env>-<resourceName>`): hylätty, koska resurssien ja stackien välinen yhteys hämärtyisi ja debuggaus vaikeutuisi.

## Seuraukset
- CDK-koodissa luodaan helper-funktiot prefixin muodostamiseen jokaiselle stackille. Kaikki resurssit nimeävät itsensä tämän avulla.
- Terraformin tai muiden työkalujen lisääminen tulevaisuudessa edellyttää samaa nimeämisstrategiaa; dokumentaatio ja lint-sääntö (esim. review PR-check) varmistavat johdonmukaisuuden.
- Resursseihin lisätään tagit `Project=traffic-cam`, `Environment=<env>`, `StackId=<stackId>`, mikä helpottaa CloudWatch ja Cost Explorer -seurantaa.
- Tulevia uusia stackeja lisättäessä on valittava yksilöllinen lyhenne (esim. `ops`), ja se dokumentoidaan tähän ADR:ään päivityksenä.
