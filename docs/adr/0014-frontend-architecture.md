# ADR 0014: Frontend-arkkitehtuuri

- Status: Accepted
- Päivämäärä: 2025-10-24

## Tausta
- Frontend on julkinen, read-only React-sovellus (ADR 0002), jonka päätoiminnot ovat:
  - näyttää viimeisimmät havainnot (kuvat, analyysit, metadata)
  - suodattaa havaintoja kameran, aikavälin ja havaintotyypin mukaan
  - selata säilytettyjä kuvia (signed URL CloudFrontin kautta)
- Sovelluksen tulee toimia nopeasti, vaikka ingest-prosessi tuottaa dataa puolen tunnin välein.

## Päätös
- **Teknologia**: Vite + React + TypeScript.
  - **TanStack Query** (React Query) vastaa REST API -datan hakemisesta, välimuistista ja automaattisesta refetch-logiikasta.
  - Yksinkertainen komponenttipohjainen arkkitehtuuri ilman erillistä state manageria.
  - Data-haku toteutetaan custom hooks -periaatteella (`useQuery` wrappereilla).
  - Globaalit UI-asetukset (aktiivinen filtteri, lightboxin tila) asuvat `UiStore`ssa; muut tilat pysyvät komponenttikohtaisina.
  - `src/App.tsx` – pääkomponentti, sisältää koko UI:n (ei erillistä reititystä).
  - `src/api.ts` – REST API client (Axios) funktioilla: `getCameras()`, `getDetections()`, `getImageUrl()`.
  - `src/types.ts` – TypeScript-tyypit API-vastauksille.
  - `src/App.css` – Google-tyylinen UI CSS.
  - TanStack Query hooks (`useQuery`) hoitavat datan haun, välimuistin ja automaattisen refetchin.
  - Kuvien lataus tapahtuu dynaamisesti presigned URL:ien kautta.
  - Document visible -event ja verkkoon paluu triggeröivät automaattisen refetchin (store action). Store rakentaa `AbortController`-tuet, jotta päällekkäiset haut perutaan.
  - CloudFront-signed URL on voimassa 10 min; galleria pyytää MobX-storelta uuden URL:n, jos HTTP 403 havaitaan tai `urlExpiresAt` on lähellä, ja näyttää välissä latausindikaattorin.
  - `ErrorBoundary` wrapaa reitit ja näyttää fallback-viestin sekä loggaa virheen CloudWatchiin API:n kautta.
  - API-häiriöissä UI näyttää datan viimeisimmän välimuistin (stale) ja varoittaa käyttäjää.

## Perustelut
- Vite tarjoaa nopean dev-palvelimen ja yksinkertaisen buildin.
- TanStack Query tarjoaa valmiin välimuistin, automaattisen refetch-logiikan, loading/error-tilat ja background updates ilman manuaalista state manageria.
- Yksinkertainen arkkitehtuuri (kaikki yhdessä App.tsx:ssä) pitää projektin kevyenä ja helposti ylläpidettävänä.
- Axios-client keskittää API-kutsut ja virheidenkäsittelyn.

## Vaihtoehdot
- `Redux Toolkit` antaisi eksplisiittisen action/reducer-rakenteen, mutta kohteen laajuus ei perustele boilerplatea.
- `MobX` tarjoaisi reactive state managementin, mutta TanStack Query riittää datan hallintaan.
- `SWR` olisi vaihtoehto TanStack Querylle, mutta TanStack Query on suositumpi ja paremmin dokumentoitu.

## Seuraukset
- TanStack Query hooks tuovat automaattisen caching- ja refetch-logiikan ilman manuaalista koodia.
- API URL on kovakoodattu `src/api.ts`:ään - tuotannossa tulee päivittää oikea API Gateway URL.
- Presigned URL:ien vanheneminen (1h) käsitellään automaattisesti uudelleenlatauksella.
- Yksinkertainen arkkitehtuuri mahdollistaa nopean kehityksen ja helpon ylläpidon.
