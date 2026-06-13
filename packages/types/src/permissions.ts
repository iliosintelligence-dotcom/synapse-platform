/**
 * Role/permission matrix — the client-side mirror of what RLS enforces
 * server-side. Used for UI affordances only; NEVER as a security boundary.
 */
import { UserRole } from './enums';

export type Permission =
  | 'property.read.public'
  | 'property.read.own_agency'
  | 'property.write.own_agency'
  | 'property.write.assigned'
  | 'agency.manage'
  | 'agency.billing'
  | 'agency.members.manage'
  | 'viewing.create'
  | 'viewing.manage.agency'
  | 'platform.admin';

const MATRIX: Record<UserRole, readonly Permission[]> = {
  [UserRole.CONSUMER]: ['property.read.public', 'viewing.create'],
  [UserRole.AGENT]: [
    'property.read.public',
    'property.read.own_agency',
    'property.write.assigned',
    'viewing.manage.agency',
  ],
  [UserRole.AGENCY_ADMIN]: [
    'property.read.public',
    'property.read.own_agency',
    'property.write.own_agency',
    'agency.members.manage',
    'viewing.manage.agency',
  ],
  [UserRole.AGENCY_OWNER]: [
    'property.read.public',
    'property.read.own_agency',
    'property.write.own_agency',
    'agency.manage',
    'agency.billing',
    'agency.members.manage',
    'viewing.manage.agency',
  ],
  [UserRole.PLATFORM_ADMIN]: ['platform.admin'],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  if (role === UserRole.PLATFORM_ADMIN) return true;
  return MATRIX[role].includes(permission);
}

export function isAgencyRole(role: UserRole): boolean {
  return (
    role === UserRole.AGENT || role === UserRole.AGENCY_ADMIN || role === UserRole.AGENCY_OWNER
  );
}
