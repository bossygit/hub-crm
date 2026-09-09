-- Premier compte créé via /register devient admin.
-- À exécuter dans le SQL Editor Supabase sur une base déjà déployée.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  existing integer;
  new_role text;
BEGIN
  SELECT count(*) INTO existing FROM public.profiles;
  IF existing = 0 THEN
    new_role := 'admin';
  ELSE
    new_role := COALESCE(NEW.raw_user_meta_data->>'role', 'employee');
  END IF;

  INSERT INTO profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    new_role
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.profiles_exist()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles);
$$;

REVOKE ALL ON FUNCTION public.profiles_exist() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profiles_exist() TO anon, authenticated;
