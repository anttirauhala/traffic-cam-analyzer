# ADR 0007: REST-rajapinta tulosten jakeluun

- Status: Accepted
- Päivämäärä: 2025-10-24

## Tausta
- Frontend on julkinen ja read-only (ADR 0002), mutta tarvitsee ajantasaiset analyysitulokset, kuvien sijainnit ja metatiedot DynamoDB:stä.
- Rajapinnan pitää olla luotettava, skaalautuva ja kustannustehokas sekä helppo integroida React-sovelluksesta.
- Tarvitaan myös mahdollisuus generoida määräaikaisia allekirjoitettuja URL-osoitteita S3/CloudFront-objekteille ilman, että bucketit avataan julkisiksi.

## Päätös
- Julkaisemme REST API:n Amazon API Gateway REST API:n käyttäen. Kaikki endpointit ovat read-only ja julkisesti saatavilla.
- API:ssa on käytössä rate limiting: 50 req/s, 100 burst, 10,000 req/päivä quota.
- CORS on konfiguroitu sallimaan kaikki origins (soveltuu julkiseen frontend-käyttöön).
- Lambda-funktiot toimivat integraatioina API Gatewayn ja DynamoDB/S3:n välillä. Kaikki Lambdat kirjoitetaan TypeScriptillä ja jaetut tyypit tulevat `packages/shared` -moduulista.
- Endpointit:
  - `GET /detections` – palauttaa sivutetun listan havainnoista. Tukee suodatuksia: `cameraId` (optional), `startDate`, `endDate`, `hasWildlife`, `hasPerson`. Jos `cameraId` puuttuu, tekee DynamoDB Scan-operaation.
  - `GET /detections/{cameraId}/{timestamp}` – palauttaa yksittäisen havainnon.
  - `GET /cameras` – palauttaa Cameras-taulusta kamerat metatietoineen (nimi, municipality, sijainti, viimeisin capture epoch).
  - `GET /cameras/{cameraId}/timestamps` – palauttaa kameran kaikki aikaleimalliset havainnot.
  - `GET /images?bucket={raw|processed}&key={objectKey}` – generoi presigned URL:n S3-kuvalle (voimassa 1h).
- API Gatewaylle on käytössä Usage Plan throttling: 50 req/s, 100 burst, 10,000 req/päivä.

## Perustelut
- REST API valittiin CORS-tuen ja Usage Plan -ominaisuuksien takia.
- Rate limiting suojaa API:a liialliselta kuormitukselta ilman erillistä autentikointia.
- Julkinen API sopii read-only-käyttötapaukseen, missä data ei ole arkaluontoista.
- Lambda-integraatio mahdollistaa liiketoimintalogiikan kapseloinnin (esim. konfiguraation yhdistäminen, signed URL -generointi) ja TypeScript-tyyppien jaon frontendin kanssa.
- Erottamalla kameralistan endpointiksi voidaan frontissa näyttää tiedot myös silloin, kun ingest ei ole vielä palauttanut havaintoja.
- WAF tarjoaa lisäsuojan ilman raskasta autentikaatiota, sopii julkiselle read-only API:lle.

## Vaihtoehdot
- Pelkkä CloudFront + S3 static JSON -dump: hylätty, koska data pitää sivuttaa ja suodattaa dynaamisesti.
- GraphQL API (AppSync): hylätty, koska query-tarpeet ovat yksinkertaiset ja REST API on kevyempi.
- HTTP API: hylätty REST API:n hyväksi Usage Plan -tuen takia.

## Seuraukset
- CDK:ssa on määriteltävä API Gateway REST API, Usage Plan rate limitingeilla ja Lambda-integraatiot.
- Lambda-funktiot tarvitsevat IAM-oikeudet: luku DynamoDB:stä, read S3:sta, presigned URL -generointi.
- Frontend `src/api.ts` sisältää API Gateway URL:n (päivitettävä tuotannossa).
- CORS on konfiguroitu sallimaan kaikki origins - tuotannossa voidaan rajoittaa tiettyyn domainiin.
- Ratkaisua monitoroidaan CloudWatchin ja API Gatewayn metriikoilla; rate limit -ylitykset näkyvät HTTP 429 -vastauksina.
