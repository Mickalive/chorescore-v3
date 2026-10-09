/**
 * ChoreScore V4 — Edit Entry (stack route)
 *
 * Balances pushes this route with `{ entryId, entryType }` so an existing
 * task or expense can be edited from the shared form. It renders the same Add
 * screen: create and edit stay in lockstep, and `router.back()` returns to
 * Balances (the form is a pushed stack screen, not a fourth tab).
 */

import React from 'react';
import AddScreen from './(tabs)/add';

export default function EditEntryScreen() {
  return <AddScreen />;
}
