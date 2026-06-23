/**
 * MVP mock data for the defining screens.
 *
 * Layer 0.5 "Week 1" is design-first: resolve the three defining screens with
 * REAL primitives before the backend is wired. Every read here has a marked
 * swap-in point to the real `@synapse/api` hook (toju.sendTojuMessage,
 * properties.getProperty, leads.createLead). Replace the mock, keep the UI.
 */
import type { PropertyData } from '@synapse/ui';

export const MOCK_PROPERTIES: PropertyData[] = [
  {
    id: 'p1',
    title: '3-Bed Apartment, Lekki Phase 1',
    location: 'Lekki Phase 1, Lagos',
    price: '₦165M',
    image: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=900&q=80',
    trustScore: 94,
    verified: true,
    aiSummary:
      '87% match — your commute from here to Lagos Island is 14 minutes shorter than comparable listings in this band, and it sits ₦12M below your stated budget.',
    nodes: [
      { name: 'Title', status: 'pass' },
      { name: 'Survey', status: 'pass' },
      { name: 'Structure', status: 'pass' },
      { name: 'Flood', status: 'pass' },
      { name: 'Legal', status: 'pass' },
      { name: 'Area', status: 'pass' },
      { name: 'Financial', status: 'pending' },
    ],
  },
  {
    id: 'p2',
    title: '3-Bed Terrace, Ikate',
    location: 'Ikate, Lekki, Lagos',
    price: '₦148M',
    image: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=900&q=80',
    trustScore: 91,
    verified: true,
    aiSummary:
      '82% match — ₦17M under your ceiling with a stronger 5-year appreciation profile than Lekki Phase 1 averages.',
    nodes: [
      { name: 'Title', status: 'pass' },
      { name: 'Survey', status: 'pass' },
      { name: 'Structure', status: 'pass' },
      { name: 'Flood', status: 'pending' },
      { name: 'Legal', status: 'pass' },
      { name: 'Area', status: 'pass' },
      { name: 'Financial', status: 'pass' },
    ],
  },
];

export function findProperty(id: string): PropertyData | undefined {
  return MOCK_PROPERTIES.find((p) => p.id === id);
}

/** A turn from Toju. `properties` ids render inline as PropertyCards. */
export interface MockTojuTurn {
  message: string;
  reasoning?: string;
  propertyIds?: string[];
  suggestions?: string[];
}

/**
 * A tiny stand-in for the toju-chat Edge Function: progressive questioning
 * (location → budget → lifestyle) then a reasoned recommendation. Swap for
 * `await toju.sendTojuMessage(text, sessionId)` when the function is live.
 */
export function mockToju(userText: string, turnIndex: number): MockTojuTurn {
  const t = userText.toLowerCase();

  if (turnIndex === 0) {
    return {
      message:
        "Congratulations on starting the search. Before I show you anything — which city or area are you focused on?",
      suggestions: ['Lekki', 'Ikoyi', 'Victoria Island'],
    };
  }
  if (/lekki|ikoyi|victoria|lagos|ikate/.test(t) && turnIndex === 1) {
    return {
      message: "Good — I have verified listings there. What's your budget?",
      suggestions: ['₦120M', '₦150M', '₦180M'],
    };
  }
  if (/\d|m|million|naira|₦/.test(t) && turnIndex >= 1) {
    return {
      message:
        "And what matters most — rental income, capital appreciation, or lifestyle and convenience?",
      suggestions: ['Capital appreciation', 'Rental income', 'Lifestyle'],
    };
  }
  // recommendation turn
  return {
    message:
      "Based on what you've told me, I'd focus less on finished luxury and more on areas where demand is growing. Two verified homes stand out — both below market for their location. Here's why.",
    reasoning:
      'Both clear independent verification, sit inside your budget, and show stronger appreciation than the Phase 1 average. Tap either to see my full take and the trust report.',
    propertyIds: ['p1', 'p2'],
    suggestions: ['Why these two?', 'Show me cheaper options'],
  };
}
