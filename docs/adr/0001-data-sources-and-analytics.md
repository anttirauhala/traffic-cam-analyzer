# ADR 0001: Kelikameradata

- Status: Accepted
- Päivämäärä: 2025-10-24

## Tausta
- Sovellus tarvitsee säännöllisesti päivittyvää kuvamateriaalia Tampereen alueen kelikameroista.
- Tavoitteena on havaita eläimiä ja ihmisiä kuvista automatisoidusti ja lähettää hälytys, jos havainto löytyy (analyysimallin valinta dokumentoidaan ADR 0003:ssa).
- Tarvitaan luotettava lähde kamerakuville ja metatiedoille ilman manuaalista ylläpitoa.

## Päätös
- Haemme kelikameratiedot ja kuvalinkit DigiTrafficin rajapinnasta `https://tie.digitraffic.fi/api/weathercam/v1/stations`.
- Valitsemme vain kamerat, joiden maantieteellinen sijainti on enintään 5 km säteellä Tampereen keskustasta (koordinaatit: 61.4978 N, 23.7610 E). Suodatus tehdään backendissä, ja vain nämä kamerat sisällytetään ingest-prosessiin.
- Hyödynnämme asemakohtaisia `state`- ja `collectionStatus`-kenttiä rajataksemme ingest-prosessiin vain kamerat ja esiasennot, jotka tuottavat ajantasaista dataa.
- Kuvien analysointiin liittyvät ratkaisut kuvataan ADR 0003:ssa.

## Perustelut
- DigiTraffic on virallinen lähde kelikameroille, päivittyy usein ja tarjoaa metatiedot (sijainti, kameran tunniste) sekä kuvalinkit avoimella lisenssillä.
- 5 km rajaus varmistaa, että ingest-prosessi pysyy kustannustehokkaana ja keskittyy Tampereen välittömään lähialueeseen.
- DigiTrafficin dokumentaatio ja SLA-tyyppinen päivittyvyys tekevät siitä ennustettavan lähteen kriittiselle datavirralle.
- Rajauksen ansiosta käsiteltävien kuvien määrä pysyy hallittavana ilman että relevantit Tampereen kamerat jäävät pois.

## Vaihtoehdot
- Suorat HTTP-lataukset Trafikomin muista rajapinnoista: hylätty, koska DigiTraffic tarjoaa yksinkertaisemman ja dokumentoidun pääsyn kelikameroihin.
- Staattinen kameralistaus ilman rajapinnan käyttöä: hylätty, koska se ei päivity automaattisesti eikä sisällä kattavia metatietoja.

## Seuraukset
- Ingest-komponentti tarvitsee geokoodauksen/suodatusfunktion Tampereen keskustan ympärille.
- Rajauksessa otetaan huomioon kameran `state` ja `collectionStatus`, jotta offline- tai huoltotilassa olevat asemat ohitetaan automaattisesti.
- Rajauslogiikka täytyy pitää konfiguroitavana, jotta kameraverkkoa voidaan tarvittaessa laajentaa.
- Kamerakohtainen konfiguraatio (esim. SSM Parameter Store tai DynamoDB) sallii määritellä, ettei tietyistä kameroista raportoidut ihmishavainnot laukaise hälytystä.
- Analyysimallia koskevat seuraukset kuvataan ADR 0003:ssa.
