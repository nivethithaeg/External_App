# KickOff database: tables and fields

Generated from the migrations (48 tables, 414 columns). **PK** = primary key, **FK → t** = points to table t, `?` = may be empty.

## Tables at a glance

| Group | Table | What it holds |
|---|---|---|
| People and accounts | `users` | Every login: customers, venue owners, admins and staff (role column). |
| People and accounts | `customer_profiles` | Extra customer details: city, gender, birth date, preferred sports, avatar. |
| People and accounts | `owner_profiles` | Venue-owner business details, application status, bank account, verification and approval flags. |
| People and accounts | `owner_documents` | Documents an owner uploads in the application (PAN, ID, deed, certificate...) and whether each was approved. |
| People and accounts | `owner_profile_changes` | Edits an approved owner asks for (business name, GST, PAN...) waiting for admin approval. |
| People and accounts | `application_events` | Timeline of an owner application: submitted, review started, document approved, info requested. |
| People and accounts | `venue_staff` | Gate-staff logins created by an owner (links a staff user to the owner). |
| People and accounts | `otp_codes` | One-time email / phone codes for signup, login verification and password reset. |
| People and accounts | `device_tokens` | Phone / browser push-notification tokens per user. |
| Venues and playing areas | `venues` | A turf venue: address, location, status (draft, pending, approved...), discount, cancellation window. |
| Venues and playing areas | `playing_areas` | A court or turf inside a venue (Turf A, Court 1) with slot length, min/max duration, capacity. |
| Venues and playing areas | `area_sports` | Which sports each playing area supports. |
| Venues and playing areas | `sports` | List of sports (football, cricket, badminton...). |
| Venues and playing areas | `facilities` | List of facilities (parking, floodlights, washroom...). |
| Venues and playing areas | `venue_facilities` | Which facilities each venue has. |
| Venues and playing areas | `venue_images` | Venue and area photos / videos, cover flag, live-photo location, approval state. |
| Venues and playing areas | `venue_documents` | Venue-level documents (licence, ownership proof) with review status. |
| Venues and playing areas | `venue_changes` | Edits to a live venue waiting for admin approval. |
| Venues and playing areas | `venue_review_checks` | Admin approval checklist ticks for a venue. |
| Venues and playing areas | `venue_addons` | Extras a venue rents out with a booking (ball, bibs, floodlights). |
| Prices and availability | `availability_rules` | Opening and closing time per area per weekday, or closed all day. |
| Prices and availability | `pricing_rules` | Price per hour for an area, sport, day type and time band. |
| Prices and availability | `price_adjustments` | Holiday / festival percentage up or down for chosen dates. |
| Prices and availability | `slot_locks` | Short hold on a slot while a customer pays (expires in minutes). |
| Bookings and payments | `bookings` | Every booking: slot time range, status, prices, discount, commission, owner amount, wallet use, series / split / reschedule info. |
| Bookings and payments | `booking_addons` | Extras bought with a booking, with the price at that time. |
| Bookings and payments | `booking_series` | Groups the bookings of a weekly repeat booking. |
| Bookings and payments | `booking_shares` | Split payment: each friend's share, link token and paid status. |
| Bookings and payments | `payments` | Razorpay orders and payments for bookings (and split shares). |
| Bookings and payments | `refunds` | Refunds with amount, reason, status and gateway refund id. |
| Bookings and payments | `wallet_lots` | Wallet credit batches with expiry (12 months) and what remains. |
| Bookings and payments | `wallet_ledger` | Every wallet movement: refund credit, admin credit, spend. |
| Bookings and payments | `coupons` | Discount codes with limits, validity and venue scope. |
| Bookings and payments | `coupon_redemptions` | Which user used which coupon on which booking. |
| Bookings and payments | `owner_payouts` | Money sent to owners: amount, period, status (pending, processing, paid, failed), bank reference. |
| Bookings and payments | `webhook_events` | Razorpay webhook ids already handled (stops double processing). |
| Bookings and payments | `open_games` | "Need players" posts attached to a booking. |
| Bookings and payments | `open_game_players` | Players who joined an open game. |
| Reviews, support and messages | `reviews` | Star rating + comment per booking, with owner reply and hidden flag. |
| Reviews, support and messages | `favourites` | Venues a customer saved. |
| Reviews, support and messages | `notifications` | In-app alerts for every user. |
| Reviews, support and messages | `support_tickets` | Customer / owner complaints and help requests. |
| Reviews, support and messages | `ticket_messages` | Replies inside a support ticket. |
| Reviews, support and messages | `banners` | Home-page banners / announcements, optionally for one city. |
| Admin and system | `audit_logs` | Who did what and when (logins, approvals, settings, payouts) with IP. |
| Admin and system | `platform_settings` | Admin settings: commission %, hold hours, GST rate, auto-payout... |
| Admin and system | `rejection_templates` | Saved rejection reasons admins reuse. |
| Admin and system | `schema_migrations` | Which database migrations were applied. |


## People and accounts

### `users`
Every login: customers, venue owners, admins and staff (role column).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `email` | text |  |
| `phone` | text | ? |
| `password_hash` | text |  |
| `full_name` | text |  |
| `role` | text |  |
| `admin_role` | text | ? |
| `email_verified` | boolean |  |
| `phone_verified` | boolean |  |
| `is_active` | boolean |  |
| `created_at` | timestamptz |  |
| `updated_at` | timestamptz |  |
| `token_version` | integer |  |
| `notification_prefs` | jsonb |  |

### `customer_profiles`
Extra customer details: city, gender, birth date, preferred sports, avatar.

| Field | Type | Notes |
|---|---|---|
| `user_id` | uuid | PK, FK → users |
| `avatar_url` | text | ? |
| `city` | text | ? |
| `birth_date` | date | ? |
| `lat` | float | ? |
| `lng` | float | ? |
| `gender` | text | ? |
| `preferred_sports` | ARRAY |  |

### `owner_profiles`
Venue-owner business details, application status, bank account, verification and approval flags.

| Field | Type | Notes |
|---|---|---|
| `user_id` | uuid | PK, FK → users |
| `business_name` | text |  |
| `gstin` | text | ? |
| `pan` | text | ? |
| `address` | text | ? |
| `verification_status` | text |  |
| `verification_note` | text | ? |
| `bank_account_name` | text | ? |
| `bank_account_number` | text | ? |
| `bank_ifsc` | text | ? |
| `upi_id` | text | ? |
| `commission_override` | numeric | ? |
| `bank_verified` | boolean |  |
| `business_type` | text | ? |
| `registration_number` | text | ? |
| `representative_name` | text | ? |
| `designation` | text | ? |
| `identity_type` | text | ? |
| `identity_consent_at` | timestamptz | ? |
| `terms_accepted_at` | timestamptz | ? |
| `terms_version` | text | ? |
| `application_ref` | text | ? |
| `application_status` | text |  |
| `submitted_at` | timestamptz | ? |
| `business_verified_at` | timestamptz | ? |
| `identity_verified_at` | timestamptz | ? |
| `business_state` | text | ? |
| `business_city` | text | ? |
| `business_pincode` | text | ? |
| `alternate_phone` | text | ? |
| `gateway_fund_account_id` | text | ? |

### `owner_documents`
Documents an owner uploads in the application (PAN, ID, deed, certificate...) and whether each was approved.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `owner_id` | uuid | FK → users |
| `doc_type` | text |  |
| `storage_key` | text |  |
| `content_type` | text |  |
| `status` | text |  |
| `note` | text | ? |
| `reviewed_by` | uuid | FK → users, ? |
| `reviewed_at` | timestamptz | ? |
| `created_at` | timestamptz |  |

### `owner_profile_changes`
Edits an approved owner asks for (business name, GST, PAN...) waiting for admin approval.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `owner_id` | uuid | FK → users |
| `fields` | jsonb |  |
| `status` | text |  |
| `note` | text | ? |
| `requested_at` | timestamptz |  |
| `updated_at` | timestamptz |  |
| `reviewed_by` | uuid | FK → users, ? |
| `reviewed_at` | timestamptz | ? |

### `application_events`
Timeline of an owner application: submitted, review started, document approved, info requested.

| Field | Type | Notes |
|---|---|---|
| `id` | bigint | PK |
| `owner_id` | uuid | FK → users |
| `kind` | text |  |
| `from_status` | text | ? |
| `to_status` | text | ? |
| `note` | text | ? |
| `items` | jsonb |  |
| `actor_id` | uuid | ? |
| `created_at` | timestamptz |  |

### `venue_staff`
Gate-staff logins created by an owner (links a staff user to the owner).

| Field | Type | Notes |
|---|---|---|
| `user_id` | uuid | PK, FK → users |
| `owner_id` | uuid | FK → users |
| `created_at` | timestamptz |  |

### `otp_codes`
One-time email / phone codes for signup, login verification and password reset.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → users |
| `channel` | text |  |
| `code_hash` | text |  |
| `expires_at` | timestamptz |  |
| `attempts` | integer |  |
| `consumed_at` | timestamptz | ? |
| `created_at` | timestamptz |  |

### `device_tokens`
Phone / browser push-notification tokens per user.

| Field | Type | Notes |
|---|---|---|
| `token` | text | PK |
| `user_id` | uuid | FK → users |
| `created_at` | timestamptz |  |


## Venues and playing areas

### `venues`
A turf venue: address, location, status (draft, pending, approved...), discount, cancellation window.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `owner_id` | uuid | FK → users |
| `name` | text |  |
| `description` | text | ? |
| `address` | text |  |
| `city` | text |  |
| `state` | text | ? |
| `pincode` | text | ? |
| `lat` | float |  |
| `lng` | float |  |
| `contact_phone` | text | ? |
| `timezone` | text |  |
| `cancellation_hours` | integer |  |
| `status` | text |  |
| `rejection_reason` | text | ? |
| `rating_avg` | numeric |  |
| `rating_count` | integer |  |
| `created_at` | timestamptz |  |
| `updated_at` | timestamptz |  |
| `category` | text | ? |
| `locality` | text | ? |
| `country` | text |  |
| `contact_email` | text | ? |
| `contact_phone2` | text | ? |
| `discount_percent` | integer |  |

### `playing_areas`
A court or turf inside a venue (Turf A, Court 1) with slot length, min/max duration, capacity.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `venue_id` | uuid | FK → venues |
| `name` | text |  |
| `surface` | text | ? |
| `capacity` | integer | ? |
| `slot_minutes` | integer |  |
| `min_duration_minutes` | integer |  |
| `max_duration_minutes` | integer |  |
| `is_active` | boolean |  |

### `area_sports`
Which sports each playing area supports.

| Field | Type | Notes |
|---|---|---|
| `area_id` | uuid | PK, FK → playing_areas |
| `sport_id` | integer | PK, FK → sports |

### `sports`
List of sports (football, cricket, badminton...).

| Field | Type | Notes |
|---|---|---|
| `id` | integer | PK |
| `name` | text |  |
| `slug` | text |  |

### `facilities`
List of facilities (parking, floodlights, washroom...).

| Field | Type | Notes |
|---|---|---|
| `id` | integer | PK |
| `name` | text |  |

### `venue_facilities`
Which facilities each venue has.

| Field | Type | Notes |
|---|---|---|
| `venue_id` | uuid | PK, FK → venues |
| `facility_id` | integer | PK, FK → facilities |

### `venue_images`
Venue and area photos / videos, cover flag, live-photo location, approval state.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `venue_id` | uuid | FK → venues |
| `url` | text |  |
| `kind` | text |  |
| `is_cover` | boolean |  |
| `sort_order` | integer |  |
| `is_pending` | boolean |  |
| `delete_requested` | boolean |  |
| `area_id` | uuid | FK → playing_areas, ? |
| `geo_lat` | float | ? |
| `geo_lng` | float | ? |
| `geo_distance_m` | integer | ? |
| `geo_address` | text | ? |

### `venue_documents`
Venue-level documents (licence, ownership proof) with review status.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `venue_id` | uuid | FK → venues |
| `doc_type` | text |  |
| `url` | text |  |
| `status` | text |  |
| `note` | text | ? |
| `reviewed_by` | uuid | FK → users, ? |
| `created_at` | timestamptz |  |

### `venue_changes`
Edits to a live venue waiting for admin approval.

| Field | Type | Notes |
|---|---|---|
| `venue_id` | uuid | PK, FK → venues |
| `fields` | jsonb |  |
| `facility_ids` | ARRAY | ? |
| `created_at` | timestamptz |  |
| `updated_at` | timestamptz |  |

### `venue_review_checks`
Admin approval checklist ticks for a venue.

| Field | Type | Notes |
|---|---|---|
| `venue_id` | uuid | PK, FK → venues |
| `key` | text | PK |
| `checked_by` | uuid | FK → users, ? |
| `checked_at` | timestamptz |  |

### `venue_addons`
Extras a venue rents out with a booking (ball, bibs, floodlights).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `venue_id` | uuid | FK → venues |
| `name` | text |  |
| `price` | numeric |  |
| `max_qty` | integer |  |
| `is_active` | boolean |  |
| `created_at` | timestamptz |  |


## Prices and availability

### `availability_rules`
Opening and closing time per area per weekday, or closed all day.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `area_id` | uuid | FK → playing_areas |
| `day_of_week` | integer |  |
| `open_time` | time without time zone |  |
| `close_time` | time without time zone |  |
| `is_closed` | boolean |  |

### `pricing_rules`
Price per hour for an area, sport, day type and time band.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `area_id` | uuid | FK → playing_areas |
| `sport_id` | integer | FK → sports, ? |
| `day_type` | text |  |
| `start_time` | time without time zone |  |
| `end_time` | time without time zone |  |
| `price_per_hour` | numeric |  |
| `day_of_week` | smallint | ? |

### `price_adjustments`
Holiday / festival percentage up or down for chosen dates.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `venue_id` | uuid | FK → venues |
| `label` | text |  |
| `start_date` | date |  |
| `end_date` | date |  |
| `percent` | integer |  |
| `created_at` | timestamptz |  |

### `slot_locks`
Short hold on a slot while a customer pays (expires in minutes).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `area_id` | uuid | FK → playing_areas |
| `user_id` | uuid | FK → users |
| `sport_id` | integer | FK → sports |
| `during` | tstzrange |  |
| `expires_at` | timestamptz |  |
| `created_at` | timestamptz |  |


## Bookings and payments

### `bookings`
Every booking: slot time range, status, prices, discount, commission, owner amount, wallet use, series / split / reschedule info.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `reference` | text |  |
| `customer_id` | uuid | FK → users, ? |
| `venue_id` | uuid | FK → venues |
| `area_id` | uuid | FK → playing_areas |
| `sport_id` | integer | FK → sports, ? |
| `during` | tstzrange |  |
| `status` | text |  |
| `subtotal` | numeric |  |
| `discount` | numeric |  |
| `total` | numeric |  |
| `commission_rate` | numeric |  |
| `commission_amount` | numeric |  |
| `owner_amount` | numeric |  |
| `coupon_id` | uuid | FK → coupons, ? |
| `notes` | text | ? |
| `qr_token` | text | ? |
| `expires_at` | timestamptz | ? |
| `cancelled_at` | timestamptz | ? |
| `cancel_reason` | text | ? |
| `created_at` | timestamptz |  |
| `block_kind` | text | ? |
| `source` | text |  |
| `walkin_name` | text | ? |
| `walkin_phone` | text | ? |
| `walkin_email` | text | ? |
| `payment_method` | text | ? |
| `venue_discount` | numeric |  |
| `reminder_24h_at` | timestamptz | ? |
| `reminder_2h_at` | timestamptz | ? |
| `cancelled_by` | text | ? |
| `reschedule_count` | integer |  |
| `rescheduled_at` | timestamptz | ? |
| `previous_starts_at` | timestamptz | ? |
| `checked_in_at` | timestamptz | ? |
| `checked_in_by` | uuid | FK → users, ? |
| `wallet_amount` | numeric |  |
| `wallet_released` | boolean |  |
| `series_id` | uuid | FK → booking_series, ? |
| `series_index` | integer | ? |
| `pay_booking_id` | uuid | FK → bookings, ? |
| `is_split` | boolean |  |
| `addons_total` | numeric |  |

### `booking_addons`
Extras bought with a booking, with the price at that time.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `booking_id` | uuid | FK → bookings |
| `addon_id` | uuid | FK → venue_addons, ? |
| `name` | text |  |
| `unit_price` | numeric |  |
| `qty` | integer |  |

### `booking_series`
Groups the bookings of a weekly repeat booking.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `customer_id` | uuid | FK → users |
| `weeks` | integer |  |
| `created_at` | timestamptz |  |

### `booking_shares`
Split payment: each friend's share, link token and paid status.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `booking_id` | uuid | FK → bookings |
| `token` | text |  |
| `amount` | numeric |  |
| `payer_id` | uuid | FK → users, ? |
| `status` | text |  |
| `paid_at` | timestamptz | ? |
| `created_at` | timestamptz |  |

### `payments`
Razorpay orders and payments for bookings (and split shares).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `booking_id` | uuid | FK → bookings |
| `razorpay_order_id` | text |  |
| `razorpay_payment_id` | text | ? |
| `razorpay_signature` | text | ? |
| `amount` | numeric |  |
| `currency` | text |  |
| `status` | text |  |
| `method` | text | ? |
| `created_at` | timestamptz |  |
| `paid_at` | timestamptz | ? |
| `share_id` | uuid | FK → booking_shares, ? |
| `payer_id` | uuid | FK → users, ? |
| `covers_all` | boolean |  |

### `refunds`
Refunds with amount, reason, status and gateway refund id.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `payment_id` | uuid | FK → payments |
| `booking_id` | uuid | FK → bookings |
| `amount` | numeric |  |
| `status` | text |  |
| `razorpay_refund_id` | text | ? |
| `reason` | text | ? |
| `requested_by` | uuid | FK → users, ? |
| `created_at` | timestamptz |  |
| `processed_at` | timestamptz | ? |

### `wallet_lots`
Wallet credit batches with expiry (12 months) and what remains.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → users |
| `amount` | numeric |  |
| `remaining` | numeric |  |
| `source` | text |  |
| `note` | text | ? |
| `booking_id` | uuid | FK → bookings, ? |
| `created_at` | timestamptz |  |
| `expires_at` | timestamptz |  |

### `wallet_ledger`
Every wallet movement: refund credit, admin credit, spend.

| Field | Type | Notes |
|---|---|---|
| `id` | bigint | PK |
| `user_id` | uuid | FK → users |
| `delta` | numeric |  |
| `kind` | text |  |
| `booking_id` | uuid | FK → bookings, ? |
| `note` | text | ? |
| `created_by` | uuid | FK → users, ? |
| `created_at` | timestamptz |  |

### `coupons`
Discount codes with limits, validity and venue scope.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `code` | text |  |
| `description` | text | ? |
| `discount_type` | text |  |
| `value` | numeric |  |
| `max_discount` | numeric | ? |
| `min_amount` | numeric |  |
| `valid_from` | timestamptz |  |
| `valid_to` | timestamptz |  |
| `usage_limit` | integer | ? |
| `used_count` | integer |  |
| `per_user_limit` | integer |  |
| `venue_id` | uuid | FK → venues, ? |
| `created_by` | uuid | FK → users, ? |
| `is_active` | boolean |  |

### `coupon_redemptions`
Which user used which coupon on which booking.

| Field | Type | Notes |
|---|---|---|
| `coupon_id` | uuid | PK, FK → coupons |
| `user_id` | uuid | FK → users |
| `booking_id` | uuid | PK, FK → bookings |

### `owner_payouts`
Money sent to owners: amount, period, status (pending, processing, paid, failed), bank reference.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `owner_id` | uuid | FK → users |
| `amount` | numeric |  |
| `period_start` | date |  |
| `period_end` | date |  |
| `status` | text |  |
| `reference` | text | ? |
| `paid_at` | timestamptz | ? |
| `created_at` | timestamptz |  |
| `gateway_payout_id` | text | ? |
| `failure_reason` | text | ? |
| `auto` | boolean |  |

### `webhook_events`
Razorpay webhook ids already handled (stops double processing).

| Field | Type | Notes |
|---|---|---|
| `event_id` | text | PK |
| `event_type` | text |  |
| `payload` | jsonb |  |
| `received_at` | timestamptz |  |

### `open_games`
"Need players" posts attached to a booking.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `booking_id` | uuid | FK → bookings |
| `host_id` | uuid | FK → users |
| `players_needed` | integer |  |
| `skill_level` | text |  |
| `fee_per_player` | numeric | ? |
| `note` | text | ? |
| `closed_at` | timestamptz | ? |
| `created_at` | timestamptz |  |

### `open_game_players`
Players who joined an open game.

| Field | Type | Notes |
|---|---|---|
| `game_id` | uuid | PK, FK → open_games |
| `user_id` | uuid | PK, FK → users |
| `created_at` | timestamptz |  |


## Reviews, support and messages

### `reviews`
Star rating + comment per booking, with owner reply and hidden flag.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `booking_id` | uuid | FK → bookings |
| `venue_id` | uuid | FK → venues |
| `customer_id` | uuid | FK → users |
| `rating` | integer |  |
| `comment` | text | ? |
| `owner_reply` | text | ? |
| `is_hidden` | boolean |  |
| `created_at` | timestamptz |  |
| `ground_rating` | integer | ? |
| `cleanliness_rating` | integer | ? |
| `facilities_rating` | integer | ? |
| `staff_rating` | integer | ? |
| `updated_at` | timestamptz | ? |

### `favourites`
Venues a customer saved.

| Field | Type | Notes |
|---|---|---|
| `user_id` | uuid | PK, FK → users |
| `venue_id` | uuid | PK, FK → venues |
| `created_at` | timestamptz |  |

### `notifications`
In-app alerts for every user.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → users |
| `title` | text |  |
| `body` | text |  |
| `type` | text |  |
| `data` | jsonb |  |
| `read_at` | timestamptz | ? |
| `created_at` | timestamptz |  |

### `support_tickets`
Customer / owner complaints and help requests.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → users |
| `booking_id` | uuid | FK → bookings, ? |
| `subject` | text |  |
| `status` | text |  |
| `priority` | text |  |
| `created_at` | timestamptz |  |
| `updated_at` | timestamptz |  |

### `ticket_messages`
Replies inside a support ticket.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `ticket_id` | uuid | FK → support_tickets |
| `author_id` | uuid | FK → users |
| `body` | text |  |
| `created_at` | timestamptz |  |

### `banners`
Home-page banners / announcements, optionally for one city.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `title` | text |  |
| `image_url` | text |  |
| `link_url` | text | ? |
| `sort_order` | integer |  |
| `is_active` | boolean |  |
| `created_at` | timestamptz |  |
| `city` | text | ? |


## Admin and system

### `audit_logs`
Who did what and when (logins, approvals, settings, payouts) with IP.

| Field | Type | Notes |
|---|---|---|
| `id` | bigint | PK |
| `actor_id` | uuid | ? |
| `action` | text |  |
| `entity` | text |  |
| `entity_id` | text | ? |
| `metadata` | jsonb |  |
| `ip` | text | ? |
| `created_at` | timestamptz |  |

### `platform_settings`
Admin settings: commission %, hold hours, GST rate, auto-payout...

| Field | Type | Notes |
|---|---|---|
| `key` | text | PK |
| `value` | jsonb |  |

### `rejection_templates`
Saved rejection reasons admins reuse.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `label` | text |  |
| `body` | text |  |
| `created_by` | uuid | FK → users, ? |
| `created_at` | timestamptz |  |

### `schema_migrations`
Which database migrations were applied.

| Field | Type | Notes |
|---|---|---|
| `name` | text | PK |
| `applied_at` | timestamptz |  |
