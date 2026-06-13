/**
 * api/properties — listing reads and writes.
 * Consumer reads hit the public RLS policy (verified+active+live only);
 * agency reads see their full inventory through the membership policy.
 */
import { getDb } from '@synapse/database';
import type {
  CreatePropertyInput,
  Paginated,
  Property,
  PropertyFilters,
  PropertyWithMedia,
  UpdatePropertyInput,
} from '@synapse/types';

const DEFAULT_LIMIT = 20;

export async function listProperties(
  filters: PropertyFilters = {},
): Promise<Paginated<PropertyWithMedia>> {
  const db = getDb();
  const limit = filters.limit ?? DEFAULT_LIMIT;
  const offset = filters.offset ?? 0;

  let query = db
    .from('properties')
    .select('*, media:property_media(*)', { count: 'exact' })
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters.city) query = query.eq('city', filters.city);
  if (filters.property_type) query = query.eq('property_type', filters.property_type);
  if (filters.listing_type) query = query.eq('listing_type', filters.listing_type);
  if (filters.agency_id) query = query.eq('agency_id', filters.agency_id);
  if (filters.min_price !== undefined) query = query.gte('price', filters.min_price);
  if (filters.max_price !== undefined) query = query.lte('price', filters.max_price);
  if (filters.min_bedrooms !== undefined) query = query.gte('bedrooms', filters.min_bedrooms);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    items: (data ?? []) as PropertyWithMedia[],
    total: count ?? 0,
    limit,
    offset,
  };
}

export async function getProperty(id: string): Promise<PropertyWithMedia> {
  const { data, error } = await getDb()
    .from('properties')
    .select('*, media:property_media(*)')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as PropertyWithMedia;
}

export async function createProperty(input: CreatePropertyInput): Promise<Property> {
  const { data, error } = await getDb()
    .from('properties')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data as Property;
}

export async function updateProperty(id: string, input: UpdatePropertyInput): Promise<Property> {
  const { data, error } = await getDb()
    .from('properties')
    .update(input)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data as Property;
}

export async function archiveProperty(id: string): Promise<void> {
  const { error } = await getDb()
    .from('properties')
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq('id', id);
  if (error) throw error;
}

/* ───────── saved properties (consumer-owned) ───────── */

export async function saveProperty(propertyId: string): Promise<void> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');

  const { error } = await db
    .from('saved_properties')
    .upsert(
      { consumer_id: auth.user.id, property_id: propertyId, deleted_at: null },
      { onConflict: 'consumer_id,property_id' },
    );
  if (error) throw error;
}

export async function unsaveProperty(propertyId: string): Promise<void> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');

  const { error } = await db
    .from('saved_properties')
    .update({ deleted_at: new Date().toISOString() })
    .eq('consumer_id', auth.user.id)
    .eq('property_id', propertyId);
  if (error) throw error;
}

export async function listSavedProperties(): Promise<PropertyWithMedia[]> {
  const db = getDb();
  const { data, error } = await db
    .from('saved_properties')
    .select('property:properties(*, media:property_media(*))')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? [])
    .map((row) => row.property as unknown as PropertyWithMedia)
    .filter((p): p is PropertyWithMedia => p !== null);
}
