# JusGo venue-owner portal vs PlaynX

Source: the public JS of https://jusgo.in (owner nav, page titles, form labels). ✅ done · 🟡 partly · ❌ not built.

## Sign-up and onboarding
| JusGo | PlaynX |
|---|---|
| Sign-up form (first/last name, email, mobile, password, confirm, terms, email OTP) | ✅ |
| Google sign-up creates an owner account on owner pages | ✅ |
| Account type: Individual / Sole Proprietorship / Partnership-Pvt Ltd with their fields, partners/directors | ✅ |
| Personal details: DOB, address line 2, country, profile photo | ✅ (in the Identity step and Verify step) |
| Documents: PAN, identity, address, authorization letter | ✅ |
| Self verification photo | 🟡 camera capture on phones; on a desktop it opens the file picker, not a live camera |
| Review and submit, tracking | ✅ |
| Owner ID (VO000001) on the Overview | ✅ |
| Delete account (reason, password, blocked by upcoming bookings) | ✅ |
| 30-day free trial and Subscription plans | 🟡 trial + plans from admin + payment history shown; paying is "checkout unavailable" like JusGo before prices are set; nothing is locked after the trial |

## Portal pages
| JusGo page | PlaynX | |
|---|---|---|
| Dashboard | Overview (cards, open slots today, revenue, status chart, shortcuts) | ✅ |
| Venues | My venues | ✅ |
| Venue form: map pin, photos, land proof (as "Ownership / lease deed"), electricity bill, 360° photo | ✅ |
| Playing areas: indoor/outdoor, roof type, advance booking limit, live geo-tagged photo | ✅ |
| Opening hours, slot settings | ✅ (no "instant booking" switch, no price-check tool) |
| Bookings, Add booking, CSV | ✅ opponent details, Event / Academic |
| Customers (search, repeat, cancellations, history, CSV) | ✅ (no manual add/edit/delete: the list comes from bookings) |
| Calendar and block time | 🟡 blocked slots exist; no "customer + amount" for an event block |
| Pricing | 🟡 special-date pricing was removed at your request |
| Report & Payments: pending payments, record payment (online/offline), bills oldest first, CSV; walk-in booking can be part-paid | ✅ |
| Integrations (apps asking to connect) | ❌ skipped: you asked to drop integration tables |
| Staff with a permission picker (7 permissions, enforced by the API) | ✅ staff portal shows Check-in, Bookings, Dashboard, Venues, Pricing as permitted; no counter-booking screen yet (API is ready) |
| Notifications | ✅ |
| Activity log (who, what, when, from where; filter, search) | ✅ |
| Profile and change requests | ✅ |
| Subscription | 🟡 see above |
| Settings | ✅ Security settings |
| Reference (videos and guides, managed by admin) | ✅ |
| Support | ✅ |

## Left to do
1. Subscription checkout and locking the portal after the trial (needs the payment gateway and your pricing decision).
2. Integrations page (skipped on purpose: integration tables were removed).
3. "Customer + amount" on a calendar block (event bookings are done through Add offline booking with Booking type = Event / Academic).

Done in the latest round: venue list search (name, city, PIN) + status and sport filters; opponent details and Event / Academic bookings; instant-booking switch (off = customers contact the venue, owner books for them) and the Check a price tool; staff counter-booking screen plus Calendar and Reports permissions; a live camera (webcam or phone) for the self-verification photo; customers added, edited and deleted by hand.
