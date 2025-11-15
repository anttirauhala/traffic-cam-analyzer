# ADR 0002: Frontend-käyttömalli ja autentikointi

- Status: Accepted
- Päivämäärä: 2025-10-24

## Tausta
- Sovelluksen React-frontend näyttää analyysien tuloksia ja S3:een tallennettuja kuvia.
- Alkuperäisessä suunnitelmassa tarkasteltiin myös manuaalisen analyysiajon käynnistämistä käyttöliittymän kautta ja käyttäjäroolien hallintaa.
- Päätös vaikuttaa infraan (tarvitaanko Cognito, yksityiset API:t) ja frontendin toteutukseen (kirjautumisvirrat, state management).

## Päätös
- Frontend julkaistaan julkisena, read-only -sovelluksena. Kaikki käyttäjät voivat selata kuvia ja analyysituloksia ilman kirjautumista.
- Frontend palvellaan S3 + CloudFront -yhdistelmällä. CloudFront hoitaa HTTPS:n ja välimuistituksen.
- Tulokset ja metatiedot haetaan API Gatewayn HTTP API:n kautta, jonka resurssit ovat read-only (GET/HEAD). Tarvittaessa käytetään rajoitettua API-avainta ja throttling-sääntöjä väärinkäytön estämiseksi.
- Ylläpito Rajaa manuaaliset ingest-ajot ainoastaan automaattisiin työnkulkuihin (EventBridge + Step Functions). Frontend ei tarjoa käynnistyspainiketta.

## Perustelut
- Julkisen katselun mahdollisuus vastaa alkuperäistä käyttötarvetta (laaja yleisö seuraa havaintoja) ilman kirjautumiskynnystä.
- Cognito/IDP poistaminen yksinkertaistaa infraa, pienentää kustannuksia ja vähentää ylläpidettävää logiikkaa.
- Read-only API vähentää riskin hallintaa: ei tarvitse miettiä vahingossa käynnistettyjä ingest-ajoja tai oikeuksien eskalaatiota.
- CloudFront tarjoaa hyvän suorituskyvyn ja mahdollisuuden rajoittaa liikennettä (rate limiting, geo restriction) ilman erillistä autentikointia.

## Vaihtoehdot
- Cognito + roolipohjainen kirjautuminen: hylätty nykyisessä vaiheessa, koska käyttöliittymä ei tarvitse muokkausoikeuksia.
- Vain staattinen sivu ilman API:a: hylätty, koska tuloksia on päivitettävä dynaamisesti S3/DynamoDB:stä.
- API:n rajaaminen IP-whitelistillä: hylätty, koska yleisön kattavuus kärsisi ja hallinnointi olisi työlästä.

## Seuraukset
- Frontend-kehitys keskittyy dynaamiseen datan näyttöön ilman kirjautumiskomponentteja.
- API Gatewayn resurssien IAM-policyt ja throttling täytyy määrittää niin, että julkinen liikenne on hallittua (esim. WAF, rate limit).
- Manuaaliset ingest-ajot ja hälytysten hallinta vaativat erilliset ylläpitotyökalut tai komentorivityökalut, koska niitä ei voi käyttää UI:n kautta.
- Dokumentaatioon ja käyttöohjeisiin on liitettävä tieto julkisesta katselumallista ja mahdollisista rajoituksista (esim. API-avain mukana pyynnöissä).
