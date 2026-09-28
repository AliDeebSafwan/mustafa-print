-- 0013_site_content.sql : what the customer website shows, all of it controlled by the owner from the staff app
--
-- Content is managed online only (uploading pictures needs a connection anyway), so these tables are not part of
-- the offline sync. Every row the public sees must be 'published'; a draft never leaves the server.

-- ---- pictures -------------------------------------------------------------------------------------------------
-- The original upload is kept private (it may carry the phone's metadata, even though we strip it). What the public
-- sees are resized WebP copies, listed in `variants`.
CREATE TABLE media (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     uuid NOT NULL REFERENCES branches(id),
  storage_key   text NOT NULL,                     -- where the private original is stored
  original_name text,
  mime_type     text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  width         integer NOT NULL CHECK (width > 0),
  height        integer NOT NULL CHECK (height > 0),
  bytes         integer NOT NULL CHECK (bytes > 0),
  variants      jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{ "width": 960, "key": "...", "bytes": 81234 }]
  alt_ar        text,                              -- required before anything using the picture can be published
  alt_en        text,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at    timestamptz,
  row_version   integer NOT NULL DEFAULT 1,
  CONSTRAINT media_id_branch_uq UNIQUE (id, branch_id)
);
CALL attach_sync_trigger('media');
COMMENT ON TABLE media IS 'Uploaded pictures. Originals are private; the website serves resized WebP variants with location data removed.';

-- ---- services: what the shop does ------------------------------------------------------------------------------
CREATE TABLE services (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id      uuid NOT NULL REFERENCES branches(id),
  slug           text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title_ar       text NOT NULL CHECK (length(trim(title_ar)) > 0),
  title_en       text,                              -- English is optional; the Arabic is shown when it is missing
  summary_ar     text,
  summary_en     text,
  body_ar        text,
  body_en        text,
  cover_media_id uuid,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  is_featured    boolean NOT NULL DEFAULT false,
  sort_order     integer NOT NULL DEFAULT 0,
  updated_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at     timestamptz,
  row_version    integer NOT NULL DEFAULT 1,
  CONSTRAINT services_id_branch_uq UNIQUE (id, branch_id),
  CONSTRAINT services_cover_fk FOREIGN KEY (cover_media_id, branch_id) REFERENCES media (id, branch_id)
);
CREATE UNIQUE INDEX services_slug_uq ON services (branch_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX services_public_idx ON services (branch_id, sort_order) WHERE status = 'published' AND deleted_at IS NULL;
CALL attach_sync_trigger('services');

-- ---- the showroom: work the shop has done ----------------------------------------------------------------------
CREATE TABLE gallery_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id      uuid NOT NULL REFERENCES branches(id),
  title_ar       text NOT NULL CHECK (length(trim(title_ar)) > 0),
  title_en       text,
  description_ar text,
  description_en text,
  service_id     uuid,                              -- lets the showroom be filtered by service
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  is_featured    boolean NOT NULL DEFAULT false,    -- shown on the home page
  sort_order     integer NOT NULL DEFAULT 0,
  updated_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at     timestamptz,
  row_version    integer NOT NULL DEFAULT 1,
  CONSTRAINT gallery_items_id_branch_uq UNIQUE (id, branch_id),
  CONSTRAINT gallery_items_service_fk FOREIGN KEY (service_id, branch_id) REFERENCES services (id, branch_id)
);
CREATE INDEX gallery_items_public_idx ON gallery_items (branch_id, sort_order) WHERE status = 'published' AND deleted_at IS NULL;
CALL attach_sync_trigger('gallery_items');

-- One piece of work can have several pictures, in the order the owner arranged them.
CREATE TABLE gallery_item_media (
  gallery_item_id uuid NOT NULL,
  media_id        uuid NOT NULL,
  branch_id       uuid NOT NULL REFERENCES branches(id),
  sort_order      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (gallery_item_id, media_id),
  CONSTRAINT gallery_item_media_item_fk  FOREIGN KEY (gallery_item_id, branch_id) REFERENCES gallery_items (id, branch_id) ON DELETE CASCADE,
  CONSTRAINT gallery_item_media_media_fk FOREIGN KEY (media_id, branch_id)        REFERENCES media (id, branch_id)
);

-- ---- products on the website -----------------------------------------------------------------------------------
-- image_url was a placeholder nobody used; a product's picture is now a real uploaded picture.
ALTER TABLE products DROP COLUMN image_url;
ALTER TABLE products ADD COLUMN cover_media_id uuid;
ALTER TABLE products ADD CONSTRAINT products_cover_fk FOREIGN KEY (cover_media_id, branch_id) REFERENCES media (id, branch_id);

-- ---- the shop's details and home page ----------------------------------------------------------------------------
CREATE TABLE site_settings (
  branch_id          uuid PRIMARY KEY REFERENCES branches(id),
  tagline_ar         text,
  tagline_en         text,
  about_ar           text,
  about_en           text,
  phone              text,
  whatsapp           text,
  email              text,
  address_ar         text,
  address_en         text,
  map_url            text CHECK (map_url IS NULL OR map_url ~ '^https://'),
  opening_hours      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ "days": "mon-fri", "opens": "09:00", "closes": "18:00" }]
  social_links       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { "facebook": "https://...", "instagram": "https://..." }
  hero_media_id      uuid,
  -- How product prices appear on the website: the exact price, "from ..." or not at all (ask for a quote).
  price_display      text NOT NULL DEFAULT 'from' CHECK (price_display IN ('exact', 'from', 'hidden')),
  updated_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp(),   -- the shared sync trigger requires it
  updated_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  row_version        integer NOT NULL DEFAULT 1,
  CONSTRAINT site_settings_hero_fk FOREIGN KEY (hero_media_id, branch_id) REFERENCES media (id, branch_id)
);
CALL attach_sync_trigger('site_settings');
COMMENT ON TABLE site_settings IS 'The shop''s public details and home page, edited by the owner. One row per branch.';
