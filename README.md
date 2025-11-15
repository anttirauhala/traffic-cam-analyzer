# Traffic Camera Analyzer

AI-pohjainen liikenekameravalvontajärjestelmä, joka analysoi Digitraffic-palvelun kamerakuvia ja havaitsee automaattisesti villieläimiä, henkilöitä ja muita kohteita käyttäen YOLO World XL -mallia.

## Järjestelmän kuvaus

### Arkkitehtuuri

Järjestelmä koostuu kolmesta pääkomponentista:

1. **Backend Workflow (AWS)** - Serverless-arkkitehtuuri kuvien haulle, analyysille ja tallennukselle
2. **REST API** - API Gateway + Lambda endpoint-toteutukset havaintojen hakuun
3. **Frontend** - React/Vite-pohjainen web-käyttöliittymä havaintojen selaamiseen

### Backend-komponentit

#### Storage Stack
- **DynamoDB Tables**:
  - `ImageDetections` - Kaikki analyysitulokset (PK: cameraId, SK: capturedAtEpoch)
  - `Cameras` - Kamerametadata (PK: cameraId)
- **S3 Buckets**:
  - Raw bucket - Alkuperäiset kuvat (lifecycle: 90d → Glacier, 365d delete)
  - Processed bucket - Analysoidut kuvat bounding boxeilla

#### Workflow Stack
- **EventBridge Scheduler** - Ajastettu käynnistys (09:00-16:00 Helsinki aikavyöhyke)
- **SQS Queues**:
  - Download queue - Kuvien latausjonot (batch size: 10)
  - Analysis queue - Analyysijono (batch size: 5, rate limiting)
- **Lambda Functions**:
  - `fetch-camera-list` - Hakee kamerat DigiTraffic API:sta (5km säde Tampereelta)
  - `download-image` - Lataa kuvat S3:een
  - `analyze-image` - Analysoi kuvat Replicate YOLO World XL:llä
  - `send-alert` - Lähettää sähköpostialertit havainnoista
- **SNS Topic** - Sähköpostialertit
- **Secrets Manager** - Replicate API-avain (5min cache)

#### API Stack
- **API Gateway REST API** - Rate limiting (50 req/s, 10k/päivä)
- **Lambda Endpoints**:
  - `GET /cameras` - Listaa kamerat
  - `GET /detections?cameraId&startDate&endDate` - Hae havaintoja
  - `GET /cameras/{id}/timestamps` - Kameran aikaleimat
  - `GET /detections/{id}/{timestamp}` - Yksittäinen havainto
  - `GET /images?bucket&key` - Presigned URL kuvalle

### Frontend

React + TypeScript -sovellus:
- TanStack Query data-haulle
- Axios HTTP-clientti
- Google-tyylinen UI
- Hakutoiminnot: yksittäinen kamera tai kaikki kamerat päivämäärällä
- Kuvamodaali click-to-expand -toiminnolla

### ML-analyysi

- **Malli**: YOLO World XL (Replicate API)
- **Luokat**: deer, moose, elk, bear, wolf, fox, wild boar, reindeer, hare, rabbit, animal, person, pedestrian, human
- **Tunnistus**: Bounding box -koordinaatit, luokka, confidence score
- **Tallenteet**: DynamoDB + merkityt kuvat S3:ssä

### Kamerasuodatus

- Etäisyys: 5km säde Tampereen keskustasta (61.4978, 23.761)
- Suodatus: Tienpintakamerat ("tienpinta"/"surface") karsittu pois
- Ajankohtainen data: `/data` endpoint tuoreimmille `measuredTime`-arvoille
- Nimeäminen: "Asema - Preset" muodossa

## Asennus ja käyttöönotto

### Esivalmistelut

1. **AWS-tilin määritys**:
   ```bash
   aws configure
   # Aseta region: eu-north-1
   ```

2. **Replicate API-avain**:
   - Rekisteröidy osoitteessa https://replicate.com
   - Luo API token
   - Tallenna AWS Secrets Manageriin:
     ```bash
     aws secretsmanager create-secret \
       --name traffic-cam/replicate-api-key \
       --secret-string "r8_your_token_here" \
       --region eu-north-1
     ```

3. **Node.js riippuvuudet**:
   ```bash
   # Infra
   cd infra
   npm install
   
   # Frontend
   cd ../frontend
   npm install
   ```

### Deployment

#### 1. Infrastruktuurin deployaus

```bash
cd infra

# Deployaa kaikki stackit (ilman email-alertteja)
npx cdk deploy --all

# TAI deployaa email-alerttien kanssa
ALERT_EMAIL="your.email@example.com" npx cdk deploy --all
```

**Huom**: Jos asetat ALERT_EMAIL:n, AWS lähettää vahvistusviestin sähköpostiisi. Klikkaa linkkiä vahvistaaksesi SNS-tilauksen.

#### 2. Yksittäisten stackien deployaus

```bash
# Vain storage
npx cdk deploy TrafficCamStorageStack

# Vain workflow
ALERT_EMAIL="your.email@example.com" npx cdk deploy TrafficCamWorkflowStack

# Vain API
npx cdk deploy TrafficCamApiStack
```

#### 3. Frontend-kehityspalvelin

```bash
cd frontend
npm run dev
# Avautuu http://localhost:5173
```

#### 4. Frontend-tuotantobuild

```bash
cd frontend
npm run build
# Build-tulos: dist/ -kansiossa
```

### Workflow-käynnistys

#### Automaattinen ajastus
- Suoritetaan automaattisesti joka tunti klo 09:00-16:00 (Helsinki)
- EventBridge Scheduler hoitaa ajastuksen

#### Manuaalinen käynnistys

```bash
# Lambda-invoke AWS CLI:llä
aws lambda invoke \
  --function-name traffic-cam-dev-wf-fetch-camera-list \
  --region eu-north-1 \
  /tmp/fetch-response.json

cat /tmp/fetch-response.json
# Vastaus: {"camerasPublished": 30}
```

## Konfigurointi

### Kameran etäisyysraja

Muokkaa `infra/src/lambdas/fetch-camera/index.ts`:

```typescript
const TAMPERE_COORDS = {
  lat: 61.4978,  // Tampere keskusta
  lon: 23.761,
};

// Handler-funktiossa:
const cameras = await flattenAndFilter(stations, 5.0); // 5km säde
```

### Ajastuksen muutos

Muokkaa `infra/lib/workflow-stack.ts`:

```typescript
const ingestSchedule = new scheduler.CfnSchedule(this, 'IngestSchedule', {
  scheduleExpression: 'cron(0 9-16 * * ? *)', // Tunneittain 9-16
  scheduleExpressionTimezone: 'Europe/Helsinki',
  // ...
});
```

### API Rate Limiting

Muokkaa `infra/lib/api-stack.ts`:

```typescript
const usagePlan = this.api.addUsagePlan('UsagePlan', {
  throttle: {
    rateLimit: 50,     // req/s
    burstLimit: 100,   // burst-katto
  },
  quota: {
    limit: 10000,           // päiväquota
    period: apigw.Period.DAY,
  },
});
```

### ML-mallin luokat

Muokkaa `infra/src/lambdas/analyze-image/index.ts`:

```typescript
const WILDLIFE_CLASSES = [
  'deer', 'moose', 'elk', 'bear', 'wolf', 'fox',
  'wild boar', 'reindeer', 'hare', 'rabbit', 'animal'
];

const PERSON_CLASSES = ['person', 'pedestrian', 'human'];
```

## Ylläpito

### Taulujen tyhjennys

```bash
cd infra
npx tsx scripts/clear-cameras-table.ts
```

### Lokit

CloudWatch Logs Groups:
- `/aws/lambda/traffic-cam-dev-wf-fetch-camera-list`
- `/aws/lambda/traffic-cam-dev-wf-download-image`
- `/aws/lambda/traffic-cam-dev-wf-analyze-image`
- `/aws/lambda/traffic-cam-dev-api-*`

### Kustannusseuranta

Arvioitu kustannus: ~$12/mois
- Lambda-suoritukset: ~$2
- Replicate API: ~$10 (25 cameras × $0.0014 × 8 runs/day × 30 days)
- DynamoDB: ilmainen (free tier)
- S3: <$1
- API Gateway: ilmainen (free tier sisällä)

## Turvallisuus

### Toteutetut suojaukset
- ✅ Lambda resource policies (vain API Gateway pääsee kutsumaan)
- ✅ API Gateway rate limiting (50 req/s, 10k/päivä)
- ✅ S3 SSL-pakotus
- ✅ IAM least privilege -periaate
- ✅ Secrets Manager API-avaimelle (5min cache)
- ✅ EventBridge → SQS → Lambda (ei suorat kutsut)

### Suositeltavat lisäsuojaukset
- ⚠️ CORS rajoitus tiettyyn frontend-domainiin
- ⚠️ API Key -autentikointi
- ⚠️ DynamoDB KMS-salaus
- ⚠️ CloudWatch Logs KMS-salaus
- ⚠️ AWS WAF API Gatewaylle

## API-dokumentaatio

### Endpoints

#### GET /cameras
Listaa kaikki kamerat.

**Vastaus**:
```json
{
  "cameras": [
    {
      "cameraId": "C04507:C0450701",
      "name": "Tie 3 Tampere, Lakalaiva - Vaasaan",
      "municipality": "Tampere",
      "lat": 61.4978,
      "lon": 23.761,
      "latestCaptureEpoch": 1731686400
    }
  ],
  "count": 14
}
```

#### GET /detections
Hae havaintoja suodattimilla.

**Query-parametrit**:
- `cameraId` (optional) - Suodata kameralla
- `startDate` (optional) - Alkaen (ISO 8601 tai epoch)
- `endDate` (optional) - Päättyen (ISO 8601 tai epoch)
- `hasWildlife` (optional) - `"true"` villieläinhavainnoille
- `hasPerson` (optional) - `"true"` henkilöhavainnoille
- `limit` (optional, max 100) - Tulosten määrä

**Vastaus**:
```json
{
  "items": [
    {
      "cameraId": "C04507:C0450701",
      "capturedAtEpoch": 1731686400,
      "capturedAt": "2025-11-15T14:00:00Z",
      "hasWildlife": true,
      "hasPerson": false,
      "detectionCount": 2,
      "detectedClasses": ["deer", "car"],
      "rawImageKey": "...",
      "processedImageKey": "..."
    }
  ],
  "count": 1,
  "nextToken": "..."
}
```

#### GET /detections/{cameraId}/{timestamp}
Yksittäisen havainnon detaljit.

#### GET /cameras/{cameraId}/timestamps
Listan kameran aikaleimoja.

#### GET /images?bucket=raw&key=...
Palauttaa presigned URL:n S3-kuvalle (1h voimassa).

## Kehitys

### Projektirakenne

```
traffic-cam-analyzer/
├── infra/                      # AWS CDK Infrastructure
│   ├── bin/                    # CDK entry point
│   ├── lib/                    # Stack-määrittelyt
│   ├── src/
│   │   ├── lambdas/           # Lambda-funktiot
│   │   │   ├── fetch-camera/
│   │   │   ├── download-image/
│   │   │   ├── analyze-image/
│   │   │   ├── send-alert/
│   │   │   └── api-*/
│   │   └── shared/            # Jaetut tyypit
│   └── scripts/               # Utility-skriptit
└── frontend/                   # React-sovellus
    ├── src/
    │   ├── App.tsx            # Pääkomponentti
    │   ├── api.ts             # API client
    │   └── types.ts           # TypeScript-tyypit
    └── public/
```

### Testaus lokaalisti

1. **Lambda-testaus**:
   ```bash
   cd infra
   npx tsx src/lambdas/fetch-camera/index.ts
   ```

2. **Frontend-testaus**:
   ```bash
   cd frontend
   npm run dev
   ```

## Vianmääritys

### Workflow ei käynnisty
1. Tarkista EventBridge Scheduler: AWS Console → EventBridge → Schedules
2. Tarkista Lambda-oikeudet: IAM → Roles → `traffic-cam-dev-wf-*`

### Ei havaintoja
1. Tarkista CloudWatch Logs: `/aws/lambda/traffic-cam-dev-wf-analyze-image`
2. Varmista Replicate API-avain: Secrets Manager
3. Tarkista rate limiting: max 6 req/min Replicate API:lle

### Frontend ei saa dataa
1. Tarkista API URL: `frontend/src/api.ts`
2. Tarkista CORS: AWS Console → API Gateway → CORS
3. Tarkista rate limits: API Gateway → Usage Plans

### Email-alertit eivät toimi
1. Vahvista SNS-tilaus sähköpostista
2. Tarkista EventBridge-sääntö: `traffic-cam-dev-wf-image-analyzed`
3. Tarkista Lambda-logit: `/aws/lambda/traffic-cam-dev-wf-send-alert`

## Lisenssi

MIT

## Tekijä

Antti Rauhala
