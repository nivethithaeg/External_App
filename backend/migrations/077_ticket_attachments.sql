-- Photos and videos attached to a support ticket by the customer or venue owner who raised it. Stored privately:
-- only that person and the admins can open them.
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    uuid        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  uploaded_by  uuid        REFERENCES users(id) ON DELETE SET NULL,
  kind         text        NOT NULL CHECK (kind IN ('image','video')),
  content_type text        NOT NULL,
  size_bytes   integer     NOT NULL,
  file_ref     text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_attachments_ticket_idx ON ticket_attachments (ticket_id);
ALTER TABLE ticket_attachments ENABLE ROW LEVEL SECURITY;
