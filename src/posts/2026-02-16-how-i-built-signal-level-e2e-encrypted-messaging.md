---
title: How I Built Signal-Level E2E Encrypted Messaging
date: 2026-02-10T12:08:00.000-05:00
excerpt: "Building a Signal-level encryption into a consumer app: A Technical deep dive"
tags: []
---
  # Building Signal-Level Encryption Into a Consumer App: A Technical Deep Dive                                                                                                                            
                                                                                                                                                                                                             
  *How I implemented X25519 + AES-256-GCM end-to-end encrypted messaging with
  forward secrecy, multi-device support, and monthly-partitioned storage from
  scratch.*

  ---

  ## Why I Built This

  Most consumer apps treat DMs as an afterthought: plaintext rows in a database
  that any backend engineer (or breach) can read. I wanted to prove that
  production-grade E2E encryption isn't reserved for Signal or WhatsApp. It can
  be built by a solo engineer on a standard stack (Swift, FastAPI, Supabase,
  PostgreSQL) without sacrificing real-time delivery, media sharing, or the UX
  people expect from modern messaging.

  This post covers the full implementation: the cryptography, the protocol
  evolution from v2 to v3, the infrastructure decisions that let it scale, and
  every roadblock I hit along the way.

  ---

  ## Architecture Overview
```
  ┌──────────────────────────────────────────────────────────────────┐
  │                        CLIENT (iOS)                              │
  │                                                                  │
  │  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
  │  │  EncryptionKey   │  │ DirectMessage    │  │  Realtime      │  │
  │  │  .swift (685 ln) │  │ Service (2984 ln)│  │  Manager       │  │
  │  │                  │  │                  │  │                │  │
  │  │ • X25519 keygen  │  │ • Send/receive   │  │ • Broadcast    │  │
  │  │ • AES-256-GCM    │  │ • Conversations  │  │   channels     │  │
  │  │ • PIN backup     │  │ • Media upload   │  │ • Typing       │  │
  │  │ • v2/v3 proto    │  │ • Key management │  │ • Reactions     │  │
  │  └────────┬─────────┘  └────────┬─────────┘  └───────┬────────┘  │
  │           │                     │                     │          │
  └───────────┼─────────────────────┼─────────────────────┼──────────┘
              │                     │                     │
              │  HTTPS (encrypted)  │                     │ WSS
              ▼                     ▼                     ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │                     BACKEND (FastAPI)                             │
  │                                                                  │
  │  ┌─────────────────────────────────────────────────────────────┐ │
  │  │              direct_messages.py (3,788 lines)               │ │
  │  │                                                             │ │
  │  │  31 API Endpoints:                                          │ │
  │  │  • Encryption key management (5)                            │ │
  │  │  • PIN-based key backup (4)                                 │ │
  │  │  • Conversations CRUD (6)                                   │ │
  │  │  • Messages send/list (7)                                   │ │
  │  │  • Reactions (3)                                            │ │
  │  │  • Typing indicators (2)                                    │ │
  │  │  • Media upload (1)                                         │ │
  │  │  • Video sharing (1)                                        │ │
  │  └─────────────────────────────┬───────────────────────────────┘ │
  │                                │                                 │
  └────────────────────────────────┼─────────────────────────────────┘
                                   │
           ┌───────────────────────┼───────────────────────┐
           │                       │                       │
           ▼                       ▼                       ▼
  ┌─────────────────┐  ┌───────────────────┐  ┌───────────────────┐
  │   PostgreSQL    │  │   S3 + CloudFront │  │ Supabase Realtime │
  │   (Supabase)    │  │                   │  │                   │
  │                 │  │  Encrypted media  │  │  Broadcast events │
  │  9 tables       │  │  blobs (useless   │  │  per-user channels│
  │  Monthly        │  │  without keys)    │  │  < 100ms latency  │
  │  partitions     │  │                   │  │                   │
  └─────────────────┘  └───────────────────┘  └───────────────────┘

  ```
  ---

  ## The Cryptography

  ### Key Generation

  Every device generates its own X25519 key pair on first launch. The private
  key never leaves the device.
```
  ┌─────────────────────────────────────────────────────┐
  │              KEY GENERATION (per device)             │
  │                                                     │
  │  1. Generate X25519 private key (32 bytes)          │
  │     └─ Curve25519.KeyAgreement.PrivateKey()         │
  │                                                     │
  │  2. Derive public key (32 bytes)                    │
  │     └─ privateKey.publicKey                         │
  │                                                     │
  │  3. Store private key in iOS Keychain               │
  │     ├─ Tag: com.app.dm.{userId}.x25519.privatekey   │
  │     ├─ Access: afterFirstUnlockThisDeviceOnly       │
  │     └─ Sync: DISABLED (never leaves device)         │
  │                                                     │
  │  4. Upload public key to server                     │
  │     └─ POST /dm/keys { public_key, device_id }      │
  └─────────────────────────────────────────────────────┘

  ```
  The Keychain tag is scoped per-user so multiple accounts on the same device
  don't collide. I explicitly disable iCloud Keychain sync
  (`kSecAttrSynchronizable: false`), the whole point is that private keys are
  device-bound.

  ### Message Encryption (V3 Protocol)

  Each message uses an ephemeral key pair, providing **forward secrecy**: even
  if a device's long-term key is compromised, past messages remain secure.
```
  ┌──────────────────────────────────────────────────────────────┐
  │                V3 ENCRYPTION FLOW (Dual-Key)                 │
  │                                                              │
  │  SENDER (Alice)                      RECIPIENT (Bob)         │
  │  ─────────────                       ──────────────          │
  │                                                              │
  │  Step 1: Generate random DEK (Data Encryption Key)           │
  │  ┌──────────────────┐                                        │
  │  │ DEK = 32 random  │  (AES-256 symmetric key)               │
  │  │ bytes via         │                                        │
  │  │ SecRandomCopyBytes│                                        │
  │  └────────┬─────────┘                                        │
  │           │                                                  │
  │  Step 2: Encrypt message with DEK                            │
  │  ┌────────▼─────────┐                                        │
  │  │ AES-256-GCM      │──► ciphertext + nonce + auth_tag       │
  │  │ seal(msg, DEK)   │                                        │
  │  └──────────────────┘                                        │
  │                                                              │
  │  Step 3: Wrap DEK for Bob (recipient)                        │
  │  ┌──────────────────────────────────────────────────────┐    │
  │  │ a. Generate ephemeral X25519 keypair                 │    │
  │  │ b. ECDH(ephemeral_priv, Bob_pub) → shared_secret     │    │
  │  │ c. HKDF-SHA256(shared_secret,                        │    │
  │  │      salt="ThisJustIn-DM-Salt-v2",                   │    │
  │  │      info="ThisJustIn-KEK-v3") → KEK (32 bytes)      │    │
  │  │ d. AES-GCM(DEK, KEK) → rwk (60 bytes)                │    │
  │  │    └─ nonce(12) + ciphertext(32) + tag(16)           │    │
  │  └──────────────────────────────────────────────────────┘    │
  │                                                              │
  │  Step 4: Wrap DEK for Alice (sender)                         │
  │  ┌──────────────────────────────────────────────────────┐    │
  │  │ Same process with Alice_pub → swk (60 bytes)          │    │
  │  └──────────────────────────────────────────────────────┘    │
  │                                                              │
  │  Step 5: Transmit                                            │
  │  ┌──────────────────────────────────────────────────────┐    │
  │  │ {                                                    │    │
  │  │   "v": "3",                                          │    │
  │  │   "alg": "X25519-AES256-GCM",                       │    │
  │  │   "epk":  "<recipient ephemeral pub>",               │    │
  │  │   "nonce":"<AES-GCM nonce (12 bytes)>",              │    │
  │  │   "ct":   "<message ciphertext>",                    │    │
  │  │   "tag":  "<auth tag (16 bytes)>",                   │    │
  │  │   "sepk": "<sender ephemeral pub>",                  │    │
  │  │   "rwk":  "<recipient wrapped key (60 bytes)>",      │    │
  │  │   "swk":  "<sender wrapped key (60 bytes)>"          │    │
  │  │ }                                                    │    │
  │  └──────────────────────────────────────────────────────┘    │
  └──────────────────────────────────────────────────────────────┘

  ```
  ### Decryption

  The recipient's client tries two paths:
```
  ┌────────────────────────────────────────────────┐
  │             V3 DECRYPTION FLOW                 │
  │                                                │
  │  Try RECIPIENT path first:                     │
  │  ┌──────────────────────────────────────────┐  │
  │  │ 1. Extract epk + rwk from JSON           │  │
  │  │ 2. ECDH(my_priv, epk) → shared_secret    │  │
  │  │ 3. HKDF → KEK                            │  │
  │  │ 4. Unwrap rwk → DEK                      │  │
  │  │ 5. AES-GCM.open(ct, DEK) → plaintext     │  │
  │  └──────────────┬───────────────────────────┘  │
  │                 │                               │
  │            FAILED?                              │
  │                 │                               │
  │  Try SENDER path:                              │
  │  ┌──────────────▼───────────────────────────┐  │
  │  │ 1. Extract sepk + swk from JSON          │  │
  │  │ 2. ECDH(my_priv, sepk) → shared_secret   │  │
  │  │ 3. HKDF → KEK                            │  │
  │  │ 4. Unwrap swk → DEK                      │  │
  │  │ 5. AES-GCM.open(ct, DEK) → plaintext     │  │
  │  └──────────────────────────────────────────┘  │
  │                                                │
  │  Both fail? → "[Unable to decrypt]"            │
  └────────────────────────────────────────────────┘

  ```
  ---

  ## The V2 → V3 Protocol Evolution (Roadblock #1)

  **The problem:** My original V2 protocol only encrypted messages for the
  recipient. The sender couldn't decrypt their own sent messages.

  This meant that if you scrolled up in a conversation, your own messages showed
  "[Encrypted message]" instead of the actual text. I papered over it with a
  local `sentMessageCache` dictionary, but that was session-scoped: closing
  the app meant losing all your sent message previews.

  **V2 vs V3 comparison:**
```
  | Aspect               | V2 (Single-Key)           | V3 (Dual-Key)                  |
  |----------------------|---------------------------|--------------------------------|
  | Who can decrypt      | Recipient only             | Both sender and recipient      |
  | Wrapped keys         | None (DEK = shared secret) | `rwk` + `swk` (60 bytes each) |
  | Sender reads history | Only from local cache      | Full decryption support        |
  | JSON fields          | `epk, nonce, ct, tag`      | + `sepk, rwk, swk`            |
  | Overhead per message | ~100 bytes                 | ~220 bytes                     |
```
  **The fix:** V3 generates a random DEK, encrypts the message once with it,
  then wraps the DEK separately for both parties. The overhead is ~120 extra
  bytes per message (two 60-byte wrapped keys). Negligible.

  **Migration:** The client auto-detects the version from the `"v"` field in
  the JSON. V2 messages still decrypt via the legacy path. All new messages
  use V3. No migration script needed as the protocol is self-describing.

  ```swift
  // Simplified detection logic
  func decrypt(_ json: String, userId: String) throws -> String {
      let parsed = try JSONSerialization.jsonObject(with: json.data(using: .utf8)!)
      let version = parsed["v"] as? String ?? "2"

      switch version {
      case "3":  return try decryptV3(parsed, userId: userId)
      default:   return try decryptV2(parsed, userId: userId)
      }
  }
```

  ---
  PIN-Based Key Backup (Roadblock #2: Multi-Device)

  The problem: Keys are device-bound. If someone gets a new phone, they
  lose access to all their message history.

  I needed a way to back up the private key without the server ever being able
  to read it. The solution: zero-knowledge PIN encryption.

```
  ┌────────────────────────────────────────────────────────────────┐
  │                   PIN BACKUP FLOW                              │
  │                                                                │
  │  BACKUP (on original device):                                  │
  │  ┌──────────────────────────────────────────────────────────┐  │
  │  │ 1. User enters 6-digit PIN                               │  │
  │  │ 2. Generate random salt (32 bytes)                        │  │
  │  │ 3. PBKDF2-HMAC-SHA256(PIN, salt, 100,000 iters) → AES key│  │
  │  │ 4. AES-256-GCM(private_key, AES_key) → encrypted blob    │  │
  │  │ 5. Upload to server:                                      │  │
  │  │    { encrypted_private_key, salt, nonce, auth_tag,        │  │
  │  │      algorithm, iterations }                              │  │
  │  └──────────────────────────────────────────────────────────┘  │
  │                                                                │
  │  RESTORE (on new device):                                      │
  │  ┌──────────────────────────────────────────────────────────┐  │
  │  │ 1. Download encrypted backup from server                  │  │
  │  │ 2. User enters PIN                                        │  │
  │  │ 3. PBKDF2(PIN, stored_salt, stored_iterations) → AES key  │  │
  │  │ 4. AES-GCM.open(blob, AES_key) → private_key (32 bytes)  │  │
  │  │ 5. Validate: is it exactly 32 bytes?                      │  │
  │  │ 6. Store in Keychain on new device                        │  │
  │  └──────────────────────────────────────────────────────────┘  │
  │                                                                │
  │  SECURITY:                                                     │
  │  ┌──────────────────────────────────────────────────────────┐  │
  │  │ • Server stores encrypted blob-cannot decrypt without PIN │  │
  │  │ • 100k PBKDF2 iterations → ~0.3s per guess on iPhone      │  │
  │  │ • Rate limit: 5 restore attempts per 5 minutes            │  │
  │  │ • All attempts logged in key_restore_attempts table       │  │
  │  │ • Wrong PIN → EncryptionError.decryptionFailed            │  │
  │  └──────────────────────────────────────────────────────────┘  │
  └────────────────────────────────────────────────────────────────┘
```

  100,000 PBKDF2 iterations was a deliberate choice. On a modern iPhone, this
  takes about 300ms-imperceptible to the user, but makes brute-forcing a 6-digit
  PIN take ~3.5 days of continuous computation per attempt batch, on top of the
  server-side rate limit.

  ---

  ## Multi-Device Key Conflict Resolution (Roadblock #3)

  **The problem:** What happens when Device A has keys, then Device B generates
  new keys? Device A can no longer decrypt new messages encrypted with Device
  B's public key.

  I identified four conflict states and built resolution flows for each:
```
  ┌──────────────────────────────────────────────────────────────┐
  │              MULTI-DEVICE STATE MACHINE                       │
  │                                                              │
  │  ┌──────────────────┐                                        │
  │  │   App Launch      │                                        │
  │  └────────┬─────────┘                                        │
  │           │                                                  │
  │           ▼                                                  │
  │  ┌──────────────────┐    YES    ┌────────────────────────┐   │
  │  │ Local keys exist? ├─────────►│ Server key == local?   │   │
  │  └────────┬─────────┘          └──────┬──────────┬──────┘   │
  │           │ NO                         │ YES      │ NO       │
  │           ▼                            ▼          ▼          │
  │  ┌──────────────────┐    ┌──────────┐  ┌─────────────────┐  │
  │  │ Server has backup?│    │  READY   │  │ KEY MISMATCH    │  │
  │  └──┬──────────┬────┘    │  (happy  │  │ DETECTED        │  │
  │     │YES       │NO       │   path)  │  │                 │  │
  │     ▼          ▼         └──────────┘  │ Show warning +  │  │
  │  ┌──────┐  ┌───────────┐              │ "Reclaim Keys"  │  │
  │  │PROMPT│  │Server has  │              │ button          │  │
  │  │ PIN  │  │keys but no │              └─────────────────┘  │
  │  │entry │  │backup?     │                                    │
  │  └──┬───┘  └──┬────┬───┘                                    │
  │     │         │YES  │NO                                      │
  │     ▼         ▼     ▼                                        │
  │  Restore   Auto-   Generate                                  │
  │  from      gen new  fresh                                    │
  │  backup    keys     keys                                     │
  │  (old msg  (old msg (first                                   │
  │  readable) lost!)   time user)                               │
  └──────────────────────────────────────────────────────────────┘
  ```
  The trickiest edge case was iOS occasionally clearing the Keychain after app
  updates. The user didn't switch devices-the OS just nuked their keys. I handle
  this by checking if the server has keys but no backup exists: in that case, I
  auto-generate new keys and log a warning. The user loses old message history,
  but messaging isn't blocked. This was a pragmatic tradeoff, i.e., blocking the user entirely would have been worse UX.

  ---

  ## Scaling Messages: Monthly Table Partitioning

  ### Why Partition?

  A single `dm_messages` table with millions of rows and a `WHERE created_at <
  cursor` clause would eventually degrade. PostgreSQL's partition pruning lets
  me keep queries fast by only scanning relevant month-partitions.
```
  ┌──────────────────────────────────────────────────────────┐
  │              MONTHLY PARTITION SCHEME                     │
  │                                                          │
  │  dm_messages (parent, partitioned by RANGE on created_at)│
  │  │                                                       │
  │  ├── dm_messages_2025_10  (Oct 2025)                     │
  │  ├── dm_messages_2025_11  (Nov 2025)                     │
  │  ├── dm_messages_2025_12  (Dec 2025)                     │
  │  ├── dm_messages_2026_01  (Jan 2026)  ◄── most queries   │
  │  └── dm_messages_2026_02  (Feb 2026)  ◄── hit these two  │
  │                                                          │
  │  Query: WHERE created_at < '2026-02-10T00:00:00Z'        │
  │  PostgreSQL only scans: 2026_02 + 2026_01 (pruned!)      │
  │                                                          │
  │  Old partitions can be detached + archived to S3          │
  │  without downtime.                                       │
  └──────────────────────────────────────────────────────────┘

  ```
  ### The Foreign Key Problem (Roadblock #4)

  PostgreSQL requires the partition key (`created_at`) in the primary key of
  partitioned tables. That means my PK is `(id, created_at)`, not just `(id)`.
  And foreign keys can only reference columns with unique constraints-which
  partitioned tables can only have if they include the partition key.

  **Result:** No FK from `dm_message_reactions.message_id` →
  `dm_messages.id`. No FK for `reply_to_message_id` either.

  **My solution:**

  1. **Application-layer validation** before every insert it verifies the message
     exists before adding a reaction.
  2. **Store `message_created_at`** alongside `message_id` in the reactions
     table, so PostgreSQL can prune to the correct partition during lookups.

  ```python
  # Before inserting a reaction, verify the message exists
  message = (
      supabase.table("dm_messages")
      .select("id, conversation_id, created_at")
      .eq("id", message_id)
      .eq("is_deleted", False)
      .maybe_single()
      .execute()
  )
  if not message.data:
      raise HTTPException(404, "Message not found")

  # Store created_at for partition-aware lookups later
  reaction_payload = {
      "message_id": message_id,
      "message_created_at": message.data["created_at"],
      "user_id": user_id,
      "emoji": emoji
  }
```
  Cursor-Based Pagination

  I use timestamp cursors instead of offset pagination. Offsets break when new
  messages arrive mid-scroll (messages get skipped or duplicated). Cursors are
  stable:

```
  ┌────────────────────────────────────────────────────────────┐
  │                CURSOR PAGINATION FLOW                       │
  │                                                            │
  │  Page 1 (initial load):                                    │
  │  ┌──────────────────────────────────────────────────────┐  │
  │  │ SELECT * FROM dm_messages                            │  │
  │  │ WHERE conversation_id = $1 AND is_deleted = FALSE    │  │
  │  │ ORDER BY created_at DESC                             │  │
  │  │ LIMIT 51;  -- fetch N+1 to check has_more            │  │
  │  └──────────────────────────────────────────────────────┘  │
  │                                                            │
  │  Response: { messages: [...50], has_more: true,            │
  │              oldest_timestamp: "2026-02-15T10:00:00Z" }    │
  │                                                            │
  │  Page 2 (scroll up):                                       │
  │  ┌──────────────────────────────────────────────────────┐  │
  │  │ SELECT * FROM dm_messages                            │  │
  │  │ WHERE conversation_id = $1 AND is_deleted = FALSE    │  │
  │  │   AND created_at < '2026-02-15T10:00:00Z'  -- cursor │  │
  │  │ ORDER BY created_at DESC                             │  │
  │  │ LIMIT 51;                                             │  │
  │  └──────────────────────────────────────────────────────┘  │
  │                                                            │
  │  PostgreSQL prunes to relevant partitions automatically.   │
  │  Index used: (conversation_id, created_at DESC, id)        │
  └────────────────────────────────────────────────────────────┘
```

  ---

  ## Real-Time Delivery

  ### Architecture Decision: Per-User Channels

  I considered two approaches for real-time message delivery:
```
  | Approach                 | Pros                     | Cons                        |
  |--------------------------|--------------------------|------------------------------|
  | Per-conversation channel | Simple mental model       | User with 50 convos = 50 WS |
  | Per-user channel         | 1 channel per user total  | Client must filter by convo  |
```
  I went with **per-user channels**. Each user subscribes to exactly one
  Supabase Realtime broadcast channel (`dm-messages-{userId}`), regardless of
  how many conversations they have. The client filters incoming events by
  `conversation_id` to route them to the active view.
```
  ┌──────────────────────────────────────────────────────────────┐
  │               REAL-TIME MESSAGE DELIVERY                     │
  │                                                              │
  │  Alice sends message to Bob                                  │
  │                                                              │
  │  ┌─────────┐   POST /messages    ┌──────────┐               │
  │  │  Alice   │──────────────────►│  Backend  │               │
  │  │  (iOS)   │                    │ (FastAPI) │               │
  │  └─────────┘                    └─────┬─────┘               │
  │                                       │                      │
  │                          ┌────────────┼────────────┐         │
  │                          │            │            │         │
  │                          ▼            ▼            ▼         │
  │                    ┌──────────┐ ┌──────────┐ ┌──────────┐   │
  │                    │ Insert   │ │ Broadcast│ │ Push      │   │
  │                    │ into     │ │ to user  │ │ notif to  │   │
  │                    │ dm_msgs  │ │ channels │ │ devices   │   │
  │                    │ table    │ │          │ │ with keys │   │
  │                    └──────────┘ └─────┬────┘ └──────────┘   │
  │                                       │                      │
  │                          ┌────────────┴────────────┐         │
  │                          ▼                         ▼         │
  │                  dm-messages-{alice}       dm-messages-{bob}  │
  │                  (confirmation)            (new message)      │
  │                          │                         │         │
  │                          ▼                         ▼         │
  │                  ┌─────────────┐          ┌──────────────┐   │
  │                  │ Alice's app │          │  Bob's app   │   │
  │                  │ (confirm)   │          │ (decrypt +   │   │
  │                  └─────────────┘          │  display)    │   │
  │                                          └──────────────┘   │
  └──────────────────────────────────────────────────────────────┘

  ```
  ### The Supabase Realtime Stream Bug (Roadblock #5)

  This one cost me hours. Supabase's Swift SDK has a non-obvious requirement:
  you must create the broadcast stream **before** subscribing to the channel.
  Reversing the order silently drops all events.

  ```swift
  // BROKEN - stream never receives events
  await channel.subscribe()
  let stream = channel.broadcastStream(event: "INSERT")

  // CORRECT - create stream first, then subscribe
  let stream = channel.broadcastStream(event: "INSERT")
  await channel.subscribe()
  await Task.yield()  // Required per Supabase GitHub issue #390
  for await message in stream { ... }
```
  The Task.yield() is necessary to let the internal subscription complete
  before iterating. Without it, the first few events can still be dropped. I
  found this after tracing through Supabase's source code and their GitHub
  issues.

  Push Notifications: Only to Devices That Can Decrypt

  A subtle but important detail: push notifications should only go to devices
  that have encryption keys. Otherwise, a user's old iPad (without keys) would
  show "New message" but then fail to decrypt it.

  I solve this by JOINing device_tokens with user_encryption_keys on
  device_id:
```
  SELECT DISTINCT dt.user_id, dt.token, dt.platform, dt.device_id
  FROM device_tokens dt
  INNER JOIN user_encryption_keys uek
      ON dt.user_id = uek.user_id
      AND dt.device_id = uek.device_id
  WHERE dt.user_id = ANY($1)
      AND uek.is_active = TRUE;
```
  ---
  Encrypted Media Attachments

  Media files (photos, videos, voice messages) are encrypted client-side before
  upload. The server and CDN only ever see encrypted blobs.

```
  ┌──────────────────────────────────────────────────────────────┐
  │              ENCRYPTED MEDIA UPLOAD FLOW                      │
  │                                                              │
  │  CLIENT                              SERVER                  │
  │  ──────                              ──────                  │
  │                                                              │
  │  1. Request upload URL ──────────►  Generate presigned S3    │
  │                                     PUT URL (5 min expiry)   │
  │                         ◄──────────  Return { upload_url,    │
  │                                              cdn_url }       │
  │                                                              │
  │  2. Generate random                                          │
  │     file_key (32 bytes)                                      │
  │     + IV (12 bytes)                                          │
  │                                                              │
  │  3. AES-256-GCM(file,                                        │
  │     file_key) → blob                                         │
  │                                                              │
  │  4. PUT blob to S3 ─────────────►  S3 stores encrypted blob │
  │     via presigned URL               (useless without key)    │
  │                                            │                 │
  │  5. Wrap file_key with                     ▼                 │
  │     X25519 (v3 protocol)            CloudFront CDN serves    │
  │     → encrypted_file_key             encrypted blob publicly │
  │                                                              │
  │  6. Send message: ──────────────►  Store message with:       │
  │     { media_url,                    encrypted_content,       │
  │       encrypted_file_key,           media_url,               │
  │       attachment_iv,                encrypted_file_key        │
  │       message_type: "image" }       (all opaque to server)   │
  │                                                              │
  │  RECIPIENT DECRYPTION:                                       │
  │  ┌──────────────────────────────────────────────────────┐    │
  │  │ 1. Download encrypted blob from CDN                  │    │
  │  │ 2. Unwrap encrypted_file_key with X25519             │    │
  │  │ 3. AES-256-GCM.open(blob, file_key, IV) → media     │    │
  │  │ 4. Display decrypted image/video/audio               │    │
  │  └──────────────────────────────────────────────────────┘    │
  └──────────────────────────────────────────────────────────────┘
```

  The key insight: encrypted blobs can sit on a public CDN. They're worthless
  without the per-message file key, which itself is wrapped with X25519. Even
  if someone compromises the CDN or S3 bucket, they get random bytes.

  ---

  ## Voice Messages

  Voice messages follow the same encryption flow as images, but with an
  additional UX challenge: waveform visualization.

  I record audio using `AVAudioRecorder` at 44.1kHz mono AAC (128kbps), with
  metering enabled at 20Hz. During recording, I sample `averagePower(forChannel:
  0)` every 50ms to build a waveform array:

  ```swift
  // Normalize dB power level to 0.0-1.0 range
  let power = recorder.averagePower(forChannel: 0)  // -160 to 0 dB
  let normalized = max(0, (power + 50) / 50)         // Clamp to 0-1
  powerLevels.append(normalized)
```
  The gesture handling uses a long-press (0.3s threshold) to start recording,
  drag-left (>100pt) to cancel with haptic feedback, and release to send. If
  duration is < 0.5s, it auto-cancels (prevents accidental sends).

  The waveform data is included in the message metadata so the recipient can
  render it without downloading the audio first.

  ---
  The Inbox Query Problem (Roadblock #6)

  The problem: Fetching a user's inbox requires conversation metadata,
  participant profiles, last messages, AND unread counts. The naive approach is
  an N+1 disaster.

  My first implementation tried to be clever: fetch the N most recent messages
  across all conversations in one query, then group by conversation. But this
  had a critical bug-if one conversation was very active, all N messages could
  come from that single conversation, leaving the rest with no preview.
```
  # BUGGY - all messages might come from one active conversation
  messages = (
      supabase.table("dm_messages")
      .select("*")
      .in_("conversation_id", conv_ids)
      .order("created_at", desc=True)
      .limit(len(conv_ids))  # not enough!
      .execute()
  )
```
  The fix: Fetch the last message per conversation individually. Yes, it's
  N queries instead of 1, but each query hits the index
  (conversation_id, created_at DESC) and returns a single row. For a typical
  inbox of 30-50 conversations, the total latency is negligible compared to the
  alternative of showing wrong (or missing) previews.

```
  ┌────────────────────────────────────────────────────────────┐
  │            OPTIMIZED INBOX QUERY PLAN                       │
  │                                                            │
  │  Step 1: Fetch participant records (1 query)               │
  │  SELECT conversation_id, unread_count, is_muted            │
  │  FROM dm_participants WHERE user_id = $1 AND is_active     │
  │                                                            │
  │  Step 2: Fetch conversations (1 query)                     │
  │  SELECT * FROM dm_conversations                            │
  │  WHERE id IN (...) ORDER BY last_message_at DESC           │
  │                                                            │
  │  Step 3: Batch fetch profiles (1 query)                    │
  │  SELECT id, username, profile_image_url FROM users          │
  │  WHERE id IN (all unique participant IDs, max 500)         │
  │                                                            │
  │  Step 4: Last message per conversation (N queries)         │
  │  FOR EACH conversation:                                    │
  │    SELECT * FROM dm_messages                               │
  │    WHERE conversation_id = $1 ORDER BY created_at DESC     │
  │    LIMIT 1                                                 │
  │                                                            │
  │  Step 5: Batch fetch reactions (1 query)                   │
  │  SELECT * FROM dm_message_reactions                        │
  │  WHERE message_id IN (all last message IDs)                │
  │                                                            │
  │  Total: ~N+4 queries (vs 3N+1 naive)                       │
  │  For 50 conversations: ~54 queries (vs ~151 naive)         │
  └────────────────────────────────────────────────────────────┘
```

  ---

  ## Other Roadblocks

  ### Roadblock #7: UUID Case Sensitivity

  PostgreSQL stores UUIDs in lowercase. Swift's `UUID.uuidString` returns
  uppercase. Every comparison between iOS and the backend silently failed until
  I added `.lowercased()` normalization everywhere.

  ```python
  # Backend: normalize every UUID from iOS
  def _normalize_user_id(user_id: str) -> str:
      return user_id.lower() if user_id else user_id
```
  ### Roadblock #8: iOS Date Format Incompatibility

  PostgreSQL returns timestamps like 2026-01-26 19:39:15.123456+00. Swift's
  JSONDecoder with .iso8601 strategy expects 2026-01-26T19:39:15+00:00
  (T separator, no fractional seconds, colon in timezone).

  I wrote a normalization function that runs on every date field before
  sending responses to iOS:
```
  def _normalize_date_to_iso8601(date_value):
      result = date_value.replace(" ", "T")       # Space → T
      result = re.sub(r'\.\d+', '', result)        # Remove .123456
      # +00 → +00:00
      tz_match = re.search(r'([+-]\d{2})$', result)
      if tz_match:
          result = result[:-3] + tz_match.group(1) + ":00"
      return result
```
  ### Roadblock #9: Real-Time Race Condition

  When a message is sent, the real-time broadcast can arrive at the recipient
  before the database transaction commits. The client receives the broadcast,
  tries to fetch the conversation, and gets a 404.

  My fix: retry with exponential backoff.
```
  private func fetchNewConversation(_ id: UUID, retryCount: Int = 0) async {
      if retryCount == 0 {
          try? await Task.sleep(nanoseconds: 500_000_000) // 0.5s
      }
      // ... attempt fetch ...
      if failed && retryCount < 2 {
          try? await Task.sleep(
              nanoseconds: UInt64(retryCount + 1) * 1_000_000_000
          )
          await fetchNewConversation(id, retryCount: retryCount + 1)
      }
  }
```
  ### Roadblock #10: Keychain Cleared After App Updates

  iOS occasionally clears Keychain entries after app updates. The user's private
  key just vanishes. I detect this by checking if the server has keys but no PIN
  backup exists-if so, I auto-generate new keys and log a warning. Old messages
  become unreadable, but the user isn't blocked from sending new ones.

  ---
  Database Schema Summary

```
  ┌─────────────────────────────────────────────────────────────┐
  │                    DATABASE SCHEMA                           │
  │                                                             │
  │  user_encryption_keys          user_key_backups             │
  │  ┌───────────────────┐        ┌──────────────────────┐      │
  │  │ id                │        │ id                   │      │
  │  │ user_id           │        │ user_id (unique)     │      │
  │  │ device_id         │        │ encrypted_private_key│      │
  │  │ public_key        │        │ key_derivation_salt  │      │
  │  │ key_algorithm     │        │ encryption_nonce     │      │
  │  │ is_active         │        │ auth_tag             │      │
  │  └───────────────────┘        │ algorithm            │      │
  │                               │ iterations (100000)  │      │
  │  dm_conversations             └──────────────────────┘      │
  │  ┌───────────────────┐                                      │
  │  │ id                │        dm_participants               │
  │  │ conversation_type │        ┌──────────────────────┐      │
  │  │ participant_ids[] │◄───────│ conversation_id      │      │
  │  │ is_paid_access    │        │ user_id              │      │
  │  │ access_price_cents│        │ unread_count         │      │
  │  │ last_message_at   │        │ last_read_message_id │      │
  │  └───────────────────┘        │ is_muted / archived  │      │
  │                               │ has_paid_access      │      │
  │  dm_messages (PARTITIONED)    └──────────────────────┘      │
  │  ┌───────────────────┐                                      │
  │  │ id + created_at   │──PK    dm_message_reactions          │
  │  │ conversation_id   │        ┌──────────────────────┐      │
  │  │ sender_id         │        │ message_id (no FK!)  │      │
  │  │ encrypted_content │        │ message_created_at   │      │
  │  │ is_encrypted      │        │ user_id              │      │
  │  │ message_type      │        │ emoji                │      │
  │  │ media_url         │        └──────────────────────┘      │
  │  │ encrypted_file_key│                                      │
  │  │ delivery_status   │        dm_typing_indicators          │
  │  │ reply_to_msg_id   │        ┌──────────────────────┐      │
  │  └───────────────────┘        │ conversation_id      │      │
  │  │                            │ user_id              │      │
  │  ├── dm_messages_2025_10      │ is_typing            │      │
  │  ├── dm_messages_2025_11      │ last_updated_at      │      │
  │  ├── dm_messages_2025_12      │ (auto-cleanup: 10s)  │      │
  │  ├── dm_messages_2026_01      └──────────────────────┘      │
  │  └── dm_messages_2026_02                                    │
  └─────────────────────────────────────────────────────────────┘
```

  ---

  ## Security Summary
```
  | Layer              | Implementation                                        |
  |--------------------|-------------------------------------------------------|
  | Key exchange       | X25519 ECDH (Curve25519)                              |
  | Message encryption | AES-256-GCM with ephemeral keys (forward secrecy)     |
  | Key derivation     | HKDF-SHA256 from ECDH shared secret                   |
  | Key backup         | PBKDF2-SHA256 (100k iterations) + AES-256-GCM         |
  | Key storage        | iOS Keychain (`afterFirstUnlockThisDeviceOnly`)       |
  | Media encryption   | Per-file AES-256 key, wrapped with X25519             |
  | Server access      | Zero-knowledge (stores public keys + encrypted blobs) |
  | Database access    | Row-Level Security on all 9 tables                    |
  | Rate limiting      | 5 backup restore attempts per 5 minutes               |
  | Push filtering     | Only devices with active encryption keys              |
```
  ---

  ## What I'd Do Differently

  1. **Use the Double Ratchet.** My current protocol provides forward secrecy
     per-message (ephemeral keys), but not future secrecy (compromised long-term
     key exposes all future messages). Signal's Double Ratchet protocol solves
     this with continuous key rotation. I skipped it for shipping speed, but
     it's the logical next step.

  2. **Client-side message database.** Currently, scrolling up requires
     re-fetching and re-decrypting messages from the server. A local encrypted
     SQLite database (like Signal's) would make this instant.

  3. **Group encryption with Sender Keys.** My current implementation encrypts
     separately for each participant. For groups > 10 people, Signal's Sender
     Keys protocol would be more efficient (one encryption per send, not N).

  4. **Better PIN UX.** A 6-digit PIN for key backup is a usability tradeoff.
     I'd explore iCloud Keychain sharing (with user opt-in) or biometric-gated
     backup as alternatives.

  ---

  ## Numbers
```
  | Metric                        | Value              |
  |-------------------------------|--------------------|
  | iOS encryption code           | 685 lines          |
  | iOS DM service                | 2,984 lines        |
  | Backend DM router             | 3,788 lines        |
  | API endpoints                 | 31                 |
  | Database tables               | 9                  |
  | Encryption overhead (v3)      | ~220 bytes/message |
  | PBKDF2 iterations             | 100,000            |
  | Key backup restore rate limit | 5 per 5 minutes    |
  | Typing indicator TTL          | 10 seconds         |
  | Real-time delivery latency    | < 100ms            |
```
  ---

  *This is the first in a series of technical deep dives from building a
  full-stack personalized news platform. I realize this was a bit of a technical blog, I'd be happy to write another one in simpler terms. Let me know what you think about this below. A blog I'm working on next: how I built a political
  compass-based recommendation engine with LightGBM, MMR diversity, and
  controlled exploration.*
