import { redirect } from 'next/navigation';

/** Root — the dashboard is the product; auth guard lives in the group layout. */
export default function Home() {
  redirect('/overview');
}
