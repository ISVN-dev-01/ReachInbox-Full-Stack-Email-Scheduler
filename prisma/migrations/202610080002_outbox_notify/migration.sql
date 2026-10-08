-- Transactional notifications are delivered only after the surrounding commit.
CREATE FUNCTION notify_outbox_ready() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('outbox_ready', '');
  RETURN NULL;
END;
$$;
CREATE TRIGGER outbox_notify AFTER INSERT ON "Outbox"
FOR EACH STATEMENT EXECUTE FUNCTION notify_outbox_ready();
