-- 0026_product_service_link.sql : lets a service page show the products a customer can order for it
ALTER TABLE products ADD COLUMN service_id uuid;
ALTER TABLE products ADD CONSTRAINT products_service_fk FOREIGN KEY (service_id, branch_id) REFERENCES services (id, branch_id);
