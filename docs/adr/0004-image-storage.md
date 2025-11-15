# ADR 0004: Kuvien ja analyysitulosten tallennus S3:een

- Status: Accepted
- Päivämäärä: 2025-10-24

## Tausta
- Ingressi hakee DigiTrafficin kelikamerakuvat kaksi kertaa tunnissa ja analyysivaihe tuottaa sekä raakakuvat että annotaatiot.
- Tulokset on säilytettävä myöhempää tarkastelua ja auditointia varten sekä tarjottava frontendille selausmahdollisuus.
- Tallennuksen on tuettava versiointia, kustannustehokasta säilytystä ja yksinkertaista integrointia AWS:n muihin palveluihin.

## Päätös
- Käytämme kahta Amazon S3 -bucketia: `traffic-cam-raw` raakakuville ja `traffic-cam-processed` analysoiduille kuville.
- Raakabucket on versioitu, jotta alkuperäinen kuva voidaan palauttaa vaikka ingest kirjoittaisi päälle. Siellä säilytetään vain alkuperäinen JPEG/PNG ilman muutoksia.
- Prosessoitu bucket sisältää AI:n tuottamat kuvat (esim. bounding box -annotaatiot) ja niihin liittyvät JSON-tiedostot (normalisoitu analyysitulos). Bucket yksilöi tiedostot polulla `<kameraId>/<timestamp>/processed.(jpg|json)`.
- Molemmat bucketit on konfiguroitu private-tilaan; frontend käyttää CloudFrontia (processed-bucket origin) ja signed URL -mekanismia.
- Tiedostot tagitetaan kameratunnisteella ja `hasWildlife`-flagilla, mikä tukee kustannusseurantaa ja mahdollisia lifecycle-sääntöjä.

## Perustelut
- S3 on kustannustehokas, skaalautuva ja tarjoilee automaattisesti korkean saatavuuden tallennustilan niin raakadatalle kuin johdannaisille.
- Jaottelu raw/processed-bucketteihin selkeyttää data lineagea ja helpottaa elinkaaripolitiikkojen hallintaa (esim. raakakuvat säilytetään pidempään kuin prosessoidut).
- Versiointi suojaa ingest-virheiltä (esim. sama kameraID ja timestamp) ja mahdollistaa audit trailin.
- S3 integroituu natiivisti Lambdaan, Step Functionsiin ja CloudFrontiin, mikä vähentää liimakoodia.

## Vaihtoehdot
- Yksi yhteinen bucket: hylätty, koska se sekoittaisi raw- ja processed-sisällöt ja vaikeuttaisi lifecycle-politiikkoja.
- Tallennus DynamoDB:hen base64-formaatissa: hylätty, koska se kasvattaisi kustannuksia ja vaikeuttaisi CDN-jakelua.
- Tallennus EFS/EBS -pohjaisessa tiedostojärjestelmässä: hylätty, koska ylläpito ja skaalautuvuus olisivat monimutkaisempia ilman lisähyötyä.

## Seuraukset
- CDK:ssa on luotava ja hallittava kaksi bucketia sekä IAM-oikeudet ingest- ja analyysi-Lambdoille.
- Lifecycle-säännöt on määritettävä (esim. raakakuvat Glacieriin 180 päivän jälkeen, prosessoidut 90 päivän jälkeen), ja niitä on ylläpidettävä.
- Frontendin CloudFront-jakauman on osoitettava processed-buckettiin käyttäen origin access controlia.
- DynamoDB/metadata-tauluun on tallennettava viitteet bucket-polkuun, jotta API voi generoida signed URL:t.
- Harkittava erillistä varmistus-/arkistointistrategiaa, jos tallenteita tarvitaan yli lifecycle-politiikan aikarajojen.
