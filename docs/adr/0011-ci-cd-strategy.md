# ADR 0011: CI/CD-strategia

- Status: Accepted
- Päivämäärä: 2025-10-24

## Tausta
- Monorepo sisältää frontendin, AWS CDK -infra-koodin ja jaetut paketit. Tarvitaan yhtenäinen tapa suorittaa testit, rakentaa artefaktit ja deployata ympäristöihin ilman manuaalisia vaiheita.
- Projekti hyödyntää GitHubia repo-isäntänä, joten luonnollinen valinta on GitHub Actions. Ympäristöjä on kaksi: `dev` ja `prod`.

## Päätös
- CI/CD toteutetaan GitHub Actions -workflow'illa, joka hyödyntää AWS OIDC -roolia (IAM) tekstin deploy-oikeuksien hallintaan.
- Rakenne:
  1. **CI Workflow (`ci.yml`)** – käynnistyy pull requesteista ja pääbranchin päivityksistä. Suorittaa:
     - `pnpm install` + `pnpm lint` (frontend, shared, infra)
     - `pnpm test` (unit + integration)
     - `pnpm cdk synth` varmistaen, että infra tuottaa validin CloudFormationin
     - Raportoi tulokset PR:ään (status checks)
  2. **Deploy Workflow (`deploy.yml`)** – käynnistyy pääbranchin mergeistä. Vaiheet:
     - Käyttää `aws-actions/configure-aws-credentials` OIDC roolin kautta (ympäristökohtainen IAM-Policy)
     - Rakentaa frontendin (`pnpm build`) ja uploudaa artefaktin S3:een/CloudFrontiin
    - Ajaa `pnpm cdk deploy` target-stackeille (`WorkflowStack`, `StorageStack`, `ApiStack`, `FrontendStack`, `MonitoringStack`)
    - Julkaisee versionumeron (git tag) ja kirjaa muutokset release-muistioon (GitHub Release)
- Ympäristökohtainen strategia:
  - `dev` deploy tapahtuu automaattisesti jokaisen pääbranchin päivityksen jälkeen
  - `prod` deploy edellyttää hyväksyttyä approveria (GitHub Environment protection) ja käyttää `cdk deploy --require-approval never` vasta hyväksynnän jälkeen
- Secrets/konfiguraatiot (API key, Replicate token) luetaan GitHub Actionsissa AWS Secrets Managerista. Workflowissa ei säilytetä pysyviä salaisuuksia.

## Perustelut
- GitHub Actions integroituu suoraan repossa tehtyihin muutoksiin ja tarjoaa ympäristö-suojaukset, jotka vastaavat ylläpitokäytäntöjä.
- OIDC + IAM rooli poistavat tarpeen pitkäikäisille AWS-avaimille CI:ssa.
- Automaattinen dev deploy antaa nopean palautteen, staging/prod vaativat manuaalisen tarkistuksen -> vähentää virhedeployn riskiä.
- Yhtenäinen pnpm-pohjainen build/test workflow helpottaa dependency-cachea ja versiohallintaa.

## Vaihtoehdot
- AWS CodePipeline/CDK Pipelines: hylätty toistaiseksi, koska GitHub Actions kattaa tarpeet ja vähentää monimutkaisuutta.
- Jenkins tai muu self-hosted CI: hylätty pienelle tiimille (ylläpitokuorma, turvallisuus).
- Yksi yhteinen workflow ilman ympäristöjaottelua: hylätty, koska tuotantoon deployn tulee olla eksplisiittinen päätös.

## Seuraukset
- Repoon lisätään `.github/workflows/ci.yml` ja `.github/workflows/deploy.yml` skriptit, joissa käytetään pnpm cachea (setup-node, setup-pnpm).
- IAM:iin luodaan ympäristökohtaiset roolit (esim. `TrafficCam-CI-Dev`, `TrafficCam-CI-Prod`) least privilege -politiikoilla.
- Release-prosessi dokumentoidaan: CI luo release note -pohjan ja ylläpitäjä tekee lopullisen julkaisun ennen prod-deployta.
- Poikkeustilanteissa (esim. hotfix) voidaan käyttää `workflow_dispatch`-käynnistystä ohi pääbranchin, mutta se edellyttää dokumentoitua runbookia.
- Pipeline tulisi testata käyttämällä dummy-deployta dev-ympäristöön ennen CI/CD-prosessin vakiointia.
