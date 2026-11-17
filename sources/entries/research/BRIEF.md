# Chennai places research — brief

The Chennai Wellness Map (a port of the Mumbai one) needs researched places.
Each research slice writes **one JSON file** in this folder: an array of row
objects with the keys below. `scripts/merge-places.mjs` merges them with the
OpenStreetMap sweep (`../osm-places.csv`), geocodes rows without coordinates,
assigns ids and tags Plum Perks / Playo venues.

## Area covered

Greater Chennai Corporation (all 15 zones), Tambaram and Avadi. That takes in
OMR as far as Sholinganallur/Semmancheri and ECR as far as Uthandi, plus
Chromepet, Pallavaram, Selaiyur, Perungalathur, Avadi, Pattabiram.

Beyond that (Navalur, Siruseri, Kelambakkam, Kovalam, Mahabalipuram, Sriperumbudur,
Ponneri…) only if it is a genuine day-trip destination, with `"out": "1"`.

Spread across the city. Rough coverage tiers — fill A and B first:

- **A**: Adyar, Besant Nagar, Anna Nagar, T. Nagar, Nungambakkam, Velachery, Perungudi/Thoraipakkam (OMR), Sholinganallur, Mylapore, Alwarpet, Thiruvanmiyur, Kilpauk, Neelankarai/Injambakkam (ECR)
- **B**: Kodambakkam, Vadapalani, K.K. Nagar, Ashok Nagar, Porur, Valasaravakkam, Virugambakkam, Mogappair, Kotturpuram, Guindy, Saidapet, Egmore, Royapettah, Teynampet, Chetpet, Purasaiwakkam, Perambur, Kolathur, Ambattur, Nanganallur, Madipakkam, Medavakkam, Pallikaranai, Karapakkam, Chromepet, Tambaram, Pallavaram, Avadi
- **C**: George Town, Royapuram, Tondiarpet, Washermanpet, Tiruvottiyur, Madhavaram, Villivakkam, Ayanavaram, Choolaimedu, Arumbakkam, Koyambedu, Ramapuram, Alandur, St. Thomas Mount, Adambakkam, Selaiyur, Perungalathur, Pammal, Pattabiram

## Owner's standing rules (absolute)

1. **Quality floor:** a venue needs **at least 20 Google reviews and a rating above 4.0**.
   If you find the Google rating and count (search snippets, Google Maps links,
   aggregator pages that quote Google), record them in `notes` as
   `Google 4.6 (312)`. If you can only find a rating on another site
   (Justdial, Practo, Zomato, Playo, Hudle), record that instead, naming the
   site, and set `v` to `Needs check`. **Never include a venue whose known
   rating is 4.0 or below, or with fewer than 20 reviews.**
2. **Exclude outright** any venue with a child-safety complaint.
3. **No religious or spiritual organisations, and no guru-led movements.**
   Healthcare run by a religious trust (a mission hospital) is fine.
4. **Closed places are out.** Check that it is still operating (recent reviews,
   current listing).
5. Flag judgement calls in `notes`; do not resolve them silently.
6. **Never invent data.** Leave a field blank rather than guess. Coordinates
   only from a source that states them (a Google Maps link with `@lat,lon` or
   `!3d…!4d…`, OSM, the venue's own page); otherwise leave `lat`/`lon` blank —
   the merge geocodes from the address.
7. **No Markdown anywhere** (no `[text](url)`, no `**`). Plain text only.

## Row format

Every row is an object with these keys (all values are strings; blank = `""`):

| key | what |
|---|---|
| `category` | One of `Move`, `Play`, `Work out`, `Eat healthy`, `Mental health`, `Check your health`, `Buy gear`, `Communities` |
| `g` | Sub-category key, from the table below |
| `s` | Sub-category label (free text, as in the table) |
| `n` | Name as the place calls itself. Chain branches: `Brand — Area` (em dash), e.g. `Cult — Anna Nagar` |
| `a` | Neighbourhood, as people say it (`Adyar`, `Anna Nagar`, `Velachery`) |
| `ad` | Street address, as complete as found, ending `Chennai 600xxx` where known |
| `lat`, `lon` | Only from a source (see rule 6) |
| `w` | Website or the booking page (Playo/Hudle/Practo) |
| `ig` | Instagram handle, `@name`, if found |
| `d` | One or two plain sentences, written for a reader choosing where to go: what it is and what is distinctive. British spelling. No hype, no "nestled", no "haven". |
| `p` | Price band: `Free`, `₹`, `₹₹`, `₹₹₹`, `₹₹₹₹` |
| `b` | Who it suits, comma-separated: `Beginners, Families, Women-only batches` |
| `t` | Hours, e.g. `6 AM – 10 PM (Mon–Sat)` |
| `tg` | Lowercase tags, pipe-separated: `badminton|indoor|synthetic` |
| `src` | `Web research` |
| `v` | `Verified` only if existence, address and that it is open are confirmed by **two independent current sources**; otherwise `Needs check` |
| `out` | `"1"` only for day-trip places outside the area above, else `"0"` |
| `map_eligible` | `"yes"` for a physical place; `"no"` for delivery-only kitchens and communities without a fixed place |
| `perk_partner` | `"yes"` if it is a branch of a Plum Perks partner (Cult/cult.fit, eat.fit, Apollo Pharmacy, Clove Dental, Sabka Dentist, Vijaya Diagnostic, Cloudnine, QI Spine, The Wellness Co, Amaha, The Sleep Company, Vetic, HUFT, Tata 1mg stores, Ultrahuman, Arva Health), else `""` |
| `src_url` | The URLs you used, separated by ` | ` |
| `notes` | Google rating/count, booking platform ("on Playo"), anything to confirm. For Communities rows, `notes` **starts with the tab category**: `Running`, `Cycling`, `Hiking & Outdoors`, `Climbing`, `Sports & Games`, `Queer Communities`, `Social & Creative` |

### Sub-categories (`g` → typical `s`)

- **Move**: `swim` Swimming pool · `track` Athletics track / stadium loop · `trek` Trek / day hike · (`run`/`cycle` routes are handled by the routes slice, not here)
- **Play**: `badminton` Badminton court · `padel` Padel / pickleball court · `tennis` Tennis court · `cricket` Cricket nets / ground · `turf` Football turf · `multisport` Multi-sport centre · `climb` Climbing wall / bouldering · `play` Karting, bowling & play · `golf` Golf · `stadium` Stadium · `specialty` Specialty sport venue (squash, skating, archery, kayaking, surfing…)
- **Work out**: `gym` Gym / Fitness center, Pilates studio, Barre studio · `yoga` Yoga studio, Yoga class · `act_gym` Dance fitness, Dance school, Martial arts, Group class
- **Eat healthy**: `healthy` Healthy café, Salad bar, Juice bar, Vegan café, Organic store, Health food store, Healthy kitchen (delivery), Millet kitchen · `nutrition` Dietitian / nutritionist
- **Mental health**: `therapy` Therapy clinic, Counselling practice, Psychiatry clinic · `alttherapy` Unconventional therapy (art/music/sound therapy — not spiritual)
- **Check your health**: `hospital` Hospital · `clinic` Dental clinic, Eye clinic, Multispeciality clinic, Specialty clinic, Women's health clinic, Pharmacy · `lab` Diagnostic lab · `physio` Physiotherapy & rehab · `newage` New-age health centre (longevity, preventive, IV, recovery)
- **Buy gear**: `retail` Sports & fitness retail, Running shoe store, Outdoor gear store, Sleep & ergonomics store · `bike` Bike shop · `wearable` Wearables store, Wearable service centre
- **Communities**: `group` Run club, Cycling club, Community / group · `hangout` Community hangout · `account` Account to follow

## Example row

```json
{"category":"Play","g":"badminton","s":"Badminton court","n":"Example Badminton Arena","a":"Velachery","ad":"12, Example Street, Velachery, Chennai 600042","lat":"","lon":"","w":"https://playo.co/venues/...","ig":"","d":"Four wooden indoor courts with good lighting, a short walk from Velachery MRTS. Coaching batches run in the mornings.","p":"₹₹","b":"Beginners, Pairs","t":"5 AM – 11 PM (all week)","tg":"badminton|indoor|wooden","src":"Web research","v":"Needs check","out":"0","map_eligible":"yes","perk_partner":"","src_url":"https://playo.co/venues/... | https://www.justdial.com/...","notes":"Google 4.5 (180); on Playo"}
```

## Working method

- Search area by area so coverage is even; don't stop at the first page of a city-wide list.
- Write the JSON file early and keep appending, so partial work survives.
- Validate the file parses (`node -e 'JSON.parse(require("fs").readFileSync(f))'`) before finishing.
- Report: row count by `g`, by tier-A/B/C area, how many `Verified`, and any judgement calls.
