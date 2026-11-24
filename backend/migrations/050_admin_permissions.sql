-- JusGo admin staff: tick exactly what each admin can do. NULL = the permissions of their role.
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_permissions text[];
