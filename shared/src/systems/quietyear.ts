// The Quiet Year has no characters: the players are the community's social
// forces, and the game lives on the map and the shared year (see
// ../quietYear.ts). This schema exists so the rest of the table — tokens,
// handouts, the world tree — has something sensible to hold when someone
// does make a sheet: a named figure from the index card, with a portrait and
// a few notes. It rolls nothing and fights nothing.

import type { SheetData, VisionStats } from '../types.js';
import { num, type SystemSchema } from './types.js';

export const quietyear: SystemSchema = {
  id: 'quietyear',
  name: 'The Quiet Year',
  tabs: [
    {
      id: 'figure',
      title: 'Figure',
      sections: [
        {
          kind: 'fields', id: 'portrait', title: 'A figure in the community',
          fields: [
            { id: 'tokenImage', label: 'Token image', type: 'image', width: 'half' },
            { id: 'detailImage', label: 'Detail / portrait', type: 'image', width: 'half' },
            { id: 'tokenColor', label: 'Token color', type: 'color', width: 'half' },
            { id: 'role', label: 'Their place in the community', type: 'text', width: 'full' },
            { id: 'bioPublic', label: 'What people say about them', type: 'textarea', width: 'full' },
          ],
        },
      ],
    },
  ],
  defaultSheet(): SheetData {
    return { role: '', bioPublic: '' };
  },
  derive(): Record<string, number | string> {
    return {};
  },
  rollables() {
    return [];
  },
  vision(sheet: SheetData): VisionStats {
    return { visionRange: num(sheet, 'visionRange', 40), darkvision: num(sheet, 'darkvision', 40) };
  },
  initiativeExpr(): string {
    return '0';
  },
  hp() {
    return { hp: 0, maxHp: 0 };
  },
  saveIds() {
    return [];
  },
  saveCheck() {
    return { expr: '0', threshold: 0, label: '' };
  },
};
