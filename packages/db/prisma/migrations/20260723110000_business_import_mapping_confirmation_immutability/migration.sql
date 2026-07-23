CREATE OR REPLACE FUNCTION "business_import_mapping_confirmation_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."confirmedAt" IS NOT NULL OR OLD."confirmedByUserId" IS NOT NULL THEN
    RAISE EXCEPTION 'BusinessImportMapping confirmed mapping is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BusinessImportMapping_confirmed_immutable"
BEFORE UPDATE OR DELETE ON "BusinessImportMapping"
FOR EACH ROW EXECUTE FUNCTION "business_import_mapping_confirmation_guard"();
