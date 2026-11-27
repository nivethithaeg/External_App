# PlaynX database: what each table is for and what each field means

Open **Supabase > Table Editor** and you will see these 48 tables. Tables such as `auth.*` or `storage.*` belong to Supabase itself; PlaynX uses only the ones below.

**How to read it:** *Type* is the Supabase column type (uuid = unique id, text, numeric = money or number, timestamptz = date and time, jsonb = flexible data, boolean = yes/no). `?` after the type means the field can be empty.


## People and accounts

### `users`
Everyone who can log in. One row per person; the role decides which portal they see.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `email` | text | Login email (unique, case-insensitive) |
| `phone` | text ? | Mobile number (unique) |
| `password_hash` | text | Password stored as a bcrypt hash, never the real password |
| `full_name` | text | Name shown in the app |
| `role` | text | customer, owner, admin or staff |
| `admin_role` | text ? | Only for admins: super_admin, operations, finance or support (what they are allowed to do) |
| `email_verified` | boolean | true after the email OTP is entered |
| `phone_verified` | boolean | true after the SMS OTP is entered |
| `is_active` | boolean | false = account blocked |
| `created_at` | timestamptz | When this row was created |
| `updated_at` | timestamptz | When this row was last changed |
| `token_version` | integer | Goes up on password change / "log out everywhere", which invalidates old login tokens |
| `notification_prefs` | jsonb | JSON: which email/push alerts the person switched off (bookings, reminders, announcements) |

### `customer_profiles`
Extra details only customers have (one row per customer).

| Field | Type | Meaning |
|---|---|---|
| `user_id` | uuid | Which user this belongs to |
| `avatar_url` | text ? | Profile photo |
| `city` | text ? | Preferred location |
| `birth_date` | date ? | Optional date of birth |
| `lat` | float ? | Saved latitude |
| `lng` | float ? | Saved longitude |
| `gender` | text ? | female, male, other or prefer_not_to_say |
| `preferred_sports` | ARRAY | List of favourite sports (used for suggestions) |

### `owner_profiles`
Business, verification and bank details of a venue owner (one row per owner).

| Field | Type | Meaning |
|---|---|---|
| `user_id` | uuid | Which user (owner) this belongs to |
| `business_name` | text | Business / firm / company / club name |
| `gstin` | text ? | GST number (optional). If present, receipts become tax invoices |
| `pan` | text ? | PAN of the business (shown masked to the owner) |
| `address` | text ? | Registered business address |
| `verification_status` | text | pending, verified or rejected: the overall owner decision |
| `verification_note` | text ? | Admin note, e.g. rejection reason |
| `bank_account_name` | text ? | Name on the bank account |
| `bank_account_number` | text ? | Account number for payouts |
| `bank_ifsc` | text ? | Bank IFSC code |
| `upi_id` | text ? | Optional UPI id |
| `commission_override` | numeric ? | If set, this owner pays this commission % instead of the platform default |
| `bank_verified` | boolean | true after finance checks the bank account. Payouts need this |
| `business_type` | text ? | sole_proprietorship, partnership, private_limited, opc, llp or trust_society |
| `registration_number` | text ? | CIN (companies), LLPIN (LLP) or trust/society registration number |
| `representative_name` | text ? | Authorized person name |
| `designation` | text ? | Their designation (Director, Partner, Secretary...) |
| `identity_type` | text ? | aadhaar_masked, passport, voter_id or driving_licence |
| `identity_consent_at` | timestamptz ? | When the owner consented to identity verification |
| `terms_accepted_at` | timestamptz ? | When the owner accepted the terms |
| `terms_version` | text ? | Which version of the terms |
| `application_ref` | text ? | Application reference number shown to the owner |
| `application_status` | text | incomplete, submitted, under_review, info_required, resubmission_required, approved or rejected |
| `submitted_at` | timestamptz ? | When the application was submitted |
| `business_verified_at` | timestamptz ? | When admin verified the Business section |
| `identity_verified_at` | timestamptz ? | When admin verified the Identity section |
| `business_state` | text ? | State of the business address |
| `business_city` | text ? | City of the business address |
| `business_pincode` | text ? | PIN code |
| `alternate_phone` | text ? | Second contact number |
| `gateway_fund_account_id` | text ? | Bank "fund account" id created at RazorpayX the first time the owner is paid, reused afterwards |

### `owner_documents`
Documents uploaded with an owner application (kept in private storage).

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `owner_id` | uuid | Owner who uploaded it |
| `doc_type` | text | pan_card, identity_proof, address_proof, business_registration, partnership_deed, incorporation_certificate, authorization_letter or profile_photo |
| `storage_key` | text | Where the file is stored (private, not a public link) |
| `content_type` | text | File type (pdf, jpg...) |
| `status` | text | pending, approved, rejected or replaced (a newer upload took its place) |
| `note` | text ? | Admin reason when rejected |
| `reviewed_by` | uuid ? | Admin who reviewed it |
| `reviewed_at` | timestamptz ? | When it was reviewed |
| `created_at` | timestamptz | When this row was created |

### `owner_profile_changes`
Edits an already-approved owner asks to make to sensitive details; admin approves or rejects.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `owner_id` | uuid | Who asked |
| `fields` | jsonb | JSON of the new values (business name, GST, PAN, address...) |
| `status` | text | pending, approved, rejected or withdrawn |
| `note` | text ? | Admin note |
| `requested_at` | timestamptz | When requested |
| `updated_at` | timestamptz | When this row was last changed |
| `reviewed_by` | uuid ? | Admin |
| `reviewed_at` | timestamptz ? | When decided |

### `application_events`
Timeline of an owner application (what the admin and owner did, in order).

| Field | Type | Meaning |
|---|---|---|
| `id` | bigint | Unique id of this row |
| `owner_id` | uuid | Whose application |
| `kind` | text | Event type: submitted, review_started, document_reviewed, section_verified, info_requested... |
| `from_status` | text ? | Status before |
| `to_status` | text ? | Status after |
| `note` | text ? | Text shown in the timeline |
| `items` | jsonb | JSON list of things the owner must fix |
| `actor_id` | uuid ? | Who did it (admin or owner) |
| `created_at` | timestamptz | When this row was created |

### `venue_staff`
Gate staff logins that an owner created. Staff can only verify and check in bookings.

| Field | Type | Meaning |
|---|---|---|
| `user_id` | uuid | The staff user |
| `owner_id` | uuid | The owner they work for |
| `created_at` | timestamptz | When this row was created |

### `otp_codes`
One-time codes for signup, phone verification and password reset.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `user_id` | uuid | Who the code is for |
| `channel` | text | email or phone |
| `code_hash` | text | The 6-digit code stored as a hash |
| `expires_at` | timestamptz | Code stops working after this |
| `attempts` | integer | Wrong tries so far (locks after too many) |
| `consumed_at` | timestamptz ? | When it was used (a code works once) |
| `created_at` | timestamptz | When this row was created |

### `device_tokens`
Phone / browser push-notification tokens (Firebase).

| Field | Type | Meaning |
|---|---|---|
| `token` | text | Push token of one device |
| `user_id` | uuid | Whose device |
| `created_at` | timestamptz | When this row was created |


## Venues and playing areas

### `venues`
A turf venue (one place, may have many playing areas).

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `owner_id` | uuid | Owner of the venue |
| `name` | text | Venue name |
| `description` | text ? | About the venue |
| `address` | text | Street address |
| `city` | text | City |
| `state` | text ? | State |
| `pincode` | text ? | PIN code |
| `lat` | float | Latitude (map pin) |
| `lng` | float | Longitude |
| `contact_phone` | text ? | Phone customers can call |
| `timezone` | text | Used to show slot times (Asia/Kolkata) |
| `cancellation_hours` | integer | Free cancellation until this many hours before the game |
| `status` | text | draft, pending (waiting for admin), ready, approved (live), rejected or suspended |
| `rejection_reason` | text ? | Why admin rejected it |
| `rating_avg` | numeric | Average star rating (updated from reviews) |
| `rating_count` | integer | Number of reviews |
| `created_at` | timestamptz | When this row was created |
| `updated_at` | timestamptz | When this row was last changed |
| `category` | text ? | Type of venue (turf, indoor court, academy...) |
| `locality` | text ? | Area / neighbourhood |
| `country` | text | Country |
| `contact_email` | text ? | Contact email |
| `contact_phone2` | text ? | Second phone |
| `discount_percent` | integer | Venue-wide discount shown on cards and taken off before any coupon |

### `playing_areas`
A court or turf inside a venue (Turf A, Court 1). Bookings are made on a playing area.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `venue_id` | uuid | Which venue |
| `name` | text | Area name |
| `surface` | text ? | Grass, artificial turf, wooden, synthetic... |
| `capacity` | integer ? | How many players fit |
| `slot_minutes` | integer | Slot length: 30 or 60 minutes |
| `min_duration_minutes` | integer | Shortest booking |
| `max_duration_minutes` | integer | Longest booking |
| `is_active` | boolean | On/off switch. false = hidden or disabled, nothing is deleted |

### `area_sports`
Which sports can be played on each playing area.

| Field | Type | Meaning |
|---|---|---|
| `area_id` | uuid | Playing area |
| `sport_id` | integer | Sport |

### `sports`
Master list of sports.

| Field | Type | Meaning |
|---|---|---|
| `id` | integer | Unique id of this row |
| `name` | text | Football, Cricket, Badminton... |
| `slug` | text | URL-friendly name (football) |

### `facilities`
Master list of facilities.

| Field | Type | Meaning |
|---|---|---|
| `id` | integer | Unique id of this row |
| `name` | text | Parking, Floodlights, Washroom... |

### `venue_facilities`
Which facilities each venue has.

| Field | Type | Meaning |
|---|---|---|
| `venue_id` | uuid | Venue |
| `facility_id` | integer | Facility |

### `venue_images`
Photos and videos of venues and areas.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `venue_id` | uuid | Venue |
| `url` | text | File link |
| `kind` | text | image or video |
| `is_cover` | boolean | The main photo on cards |
| `sort_order` | integer | Display order |
| `is_pending` | boolean | Uploaded after approval, waiting for admin |
| `delete_requested` | boolean | Owner asked to remove it, waiting for admin |
| `area_id` | uuid ? | If set, the photo belongs to one playing area |
| `geo_lat` | float ? | Latitude where a live photo was taken |
| `geo_lng` | float ? | Longitude where it was taken |
| `geo_distance_m` | integer ? | Metres between the photo spot and the venue pin (large = suspicious) |
| `geo_address` | text ? | Address read from the photo location |

### `venue_documents`
Venue documents such as licence or ownership proof.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `venue_id` | uuid | Venue |
| `doc_type` | text | Type of document |
| `url` | text | Where it is stored |
| `status` | text | pending, approved or rejected |
| `note` | text ? | Admin note |
| `reviewed_by` | uuid ? | Admin |
| `created_at` | timestamptz | When this row was created |

### `venue_changes`
Edits to a live venue that admin must approve before they show.

| Field | Type | Meaning |
|---|---|---|
| `venue_id` | uuid | Venue |
| `fields` | jsonb | JSON of changed fields |
| `facility_ids` | ARRAY ? | Changed facility list |
| `created_at` | timestamptz | When this row was created |
| `updated_at` | timestamptz | When this row was last changed |

### `venue_review_checks`
Admin approval checklist: which checks were ticked for a venue.

| Field | Type | Meaning |
|---|---|---|
| `venue_id` | uuid | Venue |
| `key` | text | Which check (photos, documents, location...) |
| `checked_by` | uuid ? | Admin |
| `checked_at` | timestamptz | When ticked |

### `venue_addons`
Extras a venue rents out with a booking (ball, bibs, floodlights).

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `venue_id` | uuid | Venue |
| `name` | text | Extra name |
| `price` | numeric | Price each in rupees |
| `max_qty` | integer | Most a customer can add |
| `is_active` | boolean | false = hidden from customers |
| `created_at` | timestamptz | When this row was created |


## Prices and availability

### `availability_rules`
Opening hours of a playing area, one row per weekday.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `area_id` | uuid | Playing area |
| `day_of_week` | integer | 0 = Sunday ... 6 = Saturday |
| `open_time` | time without time zone | Opens at |
| `close_time` | time without time zone | Closes at |
| `is_closed` | boolean | true = closed all that day |

### `pricing_rules`
Price per hour of an area, by sport, day type and time band.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `area_id` | uuid | Playing area |
| `sport_id` | integer ? | Sport (empty = all sports) |
| `day_type` | text | all, weekday or weekend |
| `start_time` | time without time zone | Band starts |
| `end_time` | time without time zone | Band ends |
| `price_per_hour` | numeric | Rupees per hour |
| `day_of_week` | smallint ? | A single weekday (optional, overrides day_type) |

### `price_adjustments`
Holiday / festival pricing: percentage change for chosen dates.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `venue_id` | uuid | Venue |
| `label` | text | Name, e.g. Diwali weekend |
| `start_date` | date | First date |
| `end_date` | date | Last date |
| `percent` | integer | +20 = 20% more, -10 = 10% less |
| `created_at` | timestamptz | When this row was created |

### `slot_locks`
A slot held for a few minutes while the customer pays (prevents double booking).

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `area_id` | uuid | Area |
| `user_id` | uuid | Customer holding it |
| `sport_id` | integer | Sport |
| `during` | tstzrange | The held time range |
| `expires_at` | timestamptz | Hold ends (about 10 minutes) |
| `created_at` | timestamptz | When this row was created |


## Bookings and money

### `bookings`
The most important table. One row per booking (also blocked slots, offline walk-ins and weekly series).

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `reference` | text | Short code shown to people (e.g. KO-AB12CD) |
| `customer_id` | uuid ? | Who booked |
| `venue_id` | uuid | Venue |
| `area_id` | uuid | Playing area |
| `sport_id` | integer ? | Sport |
| `during` | tstzrange | Start and end time as one range (the database stops overlaps) |
| `status` | text | pending (waiting for payment), confirmed, completed, cancelled, expired (unpaid), blocked (owner blocked the slot) or no_show |
| `subtotal` | numeric | Turf price before discounts |
| `discount` | numeric | Total discount (venue discount + coupon) |
| `total` | numeric | What the customer pays: subtotal - discount + extras |
| `commission_rate` | numeric | Platform % on this booking |
| `commission_amount` | numeric | PlaynX share in rupees |
| `owner_amount` | numeric | Owner share in rupees (total - commission) |
| `coupon_id` | uuid ? | Coupon used |
| `notes` | text ? | Free text |
| `qr_token` | text ? | Not used any more (the QR feature was removed) |
| `expires_at` | timestamptz ? | Unpaid booking is released after this |
| `cancelled_at` | timestamptz ? | When cancelled |
| `cancel_reason` | text ? | Why |
| `created_at` | timestamptz | When this row was created |
| `block_kind` | text ? | For blocked slots: blocked or maintenance |
| `source` | text | online or offline (owner entered a walk-in) |
| `walkin_name` | text ? | Offline customer name |
| `walkin_phone` | text ? | Offline customer phone |
| `walkin_email` | text ? | Offline customer email |
| `payment_method` | text ? | Offline: cash, upi, card or unpaid |
| `venue_discount` | numeric | The venue discount part of discount |
| `reminder_24h_at` | timestamptz ? | When the 1-day reminder was sent |
| `reminder_2h_at` | timestamptz ? | When the 2-hour reminder was sent |
| `cancelled_by` | text ? | customer or venue |
| `reschedule_count` | integer | Times it was moved (limit 1) |
| `rescheduled_at` | timestamptz ? | When it was moved |
| `previous_starts_at` | timestamptz ? | Original start time |
| `checked_in_at` | timestamptz ? | When gate staff checked the booking in |
| `checked_in_by` | uuid ? | Who scanned it |
| `wallet_amount` | numeric | Part paid from wallet credit |
| `wallet_released` | boolean | true once wallet money was handed back (unpaid / expired) |
| `series_id` | uuid ? | Weekly repeat group |
| `series_index` | integer ? | Which week (1, 2, 3...) |
| `pay_booking_id` | uuid ? | In a weekly series, the booking that carries the single payment |
| `is_split` | boolean | true if friends pay shares |
| `addons_total` | numeric | Rupees of extras included in total |

### `booking_addons`
Extras bought with a booking. Name and price are copied, so later price changes do not alter old bookings.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `booking_id` | uuid | Booking |
| `addon_id` | uuid ? | The venue extra (may be deleted later) |
| `name` | text | Name at booking time |
| `unit_price` | numeric | Price each at booking time |
| `qty` | integer | How many |

### `booking_series`
Groups the bookings of a weekly repeat booking.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `customer_id` | uuid | Who booked |
| `weeks` | integer | Number of weeks (2 to 8) |
| `created_at` | timestamptz | When this row was created |

### `booking_shares`
Split payment: each friend's share of one booking.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `booking_id` | uuid | Booking |
| `token` | text | Secret part of the payment link sent to friends |
| `amount` | numeric | This person's share in rupees |
| `payer_id` | uuid ? | Who paid it |
| `status` | text | open, paid or cancelled |
| `paid_at` | timestamptz ? | When paid |
| `created_at` | timestamptz | When this row was created |

### `payments`
Razorpay payments. One row per payment attempt (a split booking has one per share).

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `booking_id` | uuid | Booking paid for |
| `razorpay_order_id` | text | Razorpay order id created before paying |
| `razorpay_payment_id` | text ? | Razorpay payment id after paying |
| `razorpay_signature` | text ? | Proof from Razorpay that the payment is genuine |
| `amount` | numeric | Rupees charged |
| `currency` | text | INR |
| `status` | text | created, captured (paid), failed, refunded or partially_refunded |
| `method` | text ? | card, upi, netbanking... |
| `created_at` | timestamptz | When this row was created |
| `paid_at` | timestamptz ? | When captured |
| `share_id` | uuid ? | Split share this pays |
| `payer_id` | uuid ? | Who paid |
| `covers_all` | boolean | true = "pay the rest myself" covering all open shares |

### `refunds`
Money returned to customers.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `payment_id` | uuid | Original payment |
| `booking_id` | uuid | Booking |
| `amount` | numeric | Rupees refunded |
| `status` | text | pending, processed or failed |
| `razorpay_refund_id` | text ? | Razorpay refund id |
| `reason` | text ? | Why (cancellation, owner cancelled...) |
| `requested_by` | uuid ? | Who triggered it |
| `created_at` | timestamptz | When this row was created |
| `processed_at` | timestamptz ? | When the money was sent back |

### `wallet_lots`
Wallet credit in batches, each with its own expiry (12 months).

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `user_id` | uuid | Customer |
| `amount` | numeric | Original credit |
| `remaining` | numeric | Still unspent |
| `source` | text | refund, admin or release |
| `note` | text ? | Why it was added |
| `booking_id` | uuid ? | Related booking |
| `created_at` | timestamptz | When this row was created |
| `expires_at` | timestamptz | Credit expires; the soonest-expiring is used first |

### `wallet_ledger`
Every wallet movement (statement).

| Field | Type | Meaning |
|---|---|---|
| `id` | bigint | Unique id of this row |
| `user_id` | uuid | Customer |
| `delta` | numeric | + added or - spent, in rupees |
| `kind` | text | refund, admin_credit, admin_debit, booking_payment or booking_release |
| `booking_id` | uuid ? | Related booking |
| `note` | text ? | Description |
| `created_by` | uuid ? | Admin if done by hand |
| `created_at` | timestamptz | When this row was created |

### `coupons`
Discount codes.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `code` | text | What the customer types |
| `description` | text ? | Text shown |
| `discount_type` | text | percent or flat |
| `value` | numeric | Percent or rupees |
| `max_discount` | numeric ? | Cap for percent coupons |
| `min_amount` | numeric | Minimum booking value |
| `valid_from` | timestamptz | Starts |
| `valid_to` | timestamptz | Ends |
| `usage_limit` | integer ? | Total uses allowed |
| `used_count` | integer | Uses so far |
| `per_user_limit` | integer | Uses per customer |
| `venue_id` | uuid ? | Only this venue (empty = all) |
| `created_by` | uuid ? | Admin |
| `is_active` | boolean | On/off switch. false = hidden or disabled, nothing is deleted |

### `coupon_redemptions`
Which user used which coupon on which booking.

| Field | Type | Meaning |
|---|---|---|
| `coupon_id` | uuid | Coupon |
| `user_id` | uuid | Customer |
| `booking_id` | uuid | Booking |

### `owner_payouts`
Money sent from PlaynX to owners.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `owner_id` | uuid | Owner paid |
| `amount` | numeric | Rupees |
| `period_start` | date | Earnings from |
| `period_end` | date | Earnings to |
| `status` | text | pending, processing (sent to bank), paid or failed |
| `reference` | text ? | Bank UTR / reference |
| `paid_at` | timestamptz ? | When paid |
| `created_at` | timestamptz | When this row was created |
| `gateway_payout_id` | text ? | RazorpayX payout id |
| `failure_reason` | text ? | Why the bank failed it |
| `auto` | boolean | true = created by the automatic payout job |

### `webhook_events`
Razorpay webhook ids already handled (prevents processing the same event twice).

| Field | Type | Meaning |
|---|---|---|
| `event_id` | text | Razorpay event id |
| `event_type` | text | payment.captured, refund.processed, payout.processed... |
| `payload` | jsonb | Full JSON received |
| `received_at` | timestamptz | When it arrived |

### `open_games`
"Need players" posts for a confirmed booking.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `booking_id` | uuid | The host's booking |
| `host_id` | uuid | Who is looking for players |
| `players_needed` | integer | How many more players |
| `skill_level` | text | any, beginner, intermediate or advanced |
| `fee_per_player` | numeric ? | Optional share players pay the host directly |
| `note` | text ? | Message to players |
| `closed_at` | timestamptz ? | Host stopped looking |
| `created_at` | timestamptz | When this row was created |

### `open_game_players`
Players who joined an open game.

| Field | Type | Meaning |
|---|---|---|
| `game_id` | uuid | Game |
| `user_id` | uuid | Player |
| `created_at` | timestamptz | When this row was created |


## Reviews, support and messages

### `reviews`
Star rating and comment for a completed booking (one per booking).

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `booking_id` | uuid | Booking reviewed |
| `venue_id` | uuid | Venue |
| `customer_id` | uuid | Reviewer |
| `rating` | integer | Overall 1 to 5 stars |
| `comment` | text ? | Written review |
| `owner_reply` | text ? | Owner reply |
| `is_hidden` | boolean | Admin hid it |
| `created_at` | timestamptz | When this row was created |
| `ground_rating` | integer ? | Stars for the ground |
| `cleanliness_rating` | integer ? | Stars for cleanliness |
| `facilities_rating` | integer ? | Stars for facilities |
| `staff_rating` | integer ? | Stars for staff |
| `updated_at` | timestamptz ? | When this row was last changed |

### `favourites`
Venues a customer saved.

| Field | Type | Meaning |
|---|---|---|
| `user_id` | uuid | Customer |
| `venue_id` | uuid | Venue |
| `created_at` | timestamptz | When this row was created |

### `notifications`
In-app alerts (the bell).

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `user_id` | uuid | Who gets it |
| `title` | text | Heading |
| `body` | text | Message |
| `type` | text | Kind: booking_confirmed, payout, application, open_game... |
| `data` | jsonb | JSON with a link to open |
| `read_at` | timestamptz ? | When read (empty = unread) |
| `created_at` | timestamptz | When this row was created |

### `support_tickets`
Complaints and help requests.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `user_id` | uuid | Who raised it |
| `booking_id` | uuid ? | Related booking (a complaint holds the owner payout) |
| `subject` | text | Title |
| `status` | text | open, in_progress, resolved or closed |
| `priority` | text | low, normal or high |
| `created_at` | timestamptz | When this row was created |
| `updated_at` | timestamptz | When this row was last changed |

### `ticket_messages`
Messages inside a ticket.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `ticket_id` | uuid | Ticket |
| `author_id` | uuid | Who wrote it |
| `body` | text | Message |
| `created_at` | timestamptz | When this row was created |

### `banners`
Home-page banners and announcements.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `title` | text | Text |
| `image_url` | text | Picture |
| `link_url` | text ? | Where it goes |
| `sort_order` | integer | Order |
| `is_active` | boolean | On/off switch. false = hidden or disabled, nothing is deleted |
| `created_at` | timestamptz | When this row was created |
| `city` | text ? | Only shown in this city (empty = everywhere) |


## Admin and system

### `audit_logs`
Security trail: who did what, when, from where.

| Field | Type | Meaning |
|---|---|---|
| `id` | bigint | Unique id of this row |
| `actor_id` | uuid ? | Who did it |
| `action` | text | user.login, payout.create, settings.update... |
| `entity` | text | What it was done to (venue, payout...) |
| `entity_id` | text ? | Which one |
| `metadata` | jsonb | JSON details |
| `ip` | text ? | IP address |
| `created_at` | timestamptz | When this row was created |

### `platform_settings`
Admin settings as key / value pairs.

| Field | Type | Meaning |
|---|---|---|
| `key` | text | commission_percent, payout_hold_hours, gst_rate, gst_sac, auto_payouts, auto_payout_min, slot_lock_minutes, max_advance_booking_days |
| `value` | jsonb | The value (JSON) |

### `rejection_templates`
Saved rejection reasons admins reuse.

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Unique id of this row |
| `label` | text | Short name |
| `body` | text | Full text sent to the owner |
| `created_by` | uuid ? | Admin |
| `created_at` | timestamptz | When this row was created |

### `schema_migrations`
Which database migration files have been applied (001 to 034).

| Field | Type | Meaning |
|---|---|---|
| `name` | text | Migration file name |
| `applied_at` | timestamptz | When it ran |
