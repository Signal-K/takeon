import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/util/events.js';
import { Simulation } from '../src/sim/simulation.js';
import { CAMERA_ELEVATION_DEG, TILE_H, TILE_W, TILE_Z } from '../src/render/sprites.js';
import {
  defaultSurveyBody,
  formationStand,
  surveySnapshot,
  surveySpec,
  SURVEY_CHROME,
} from '../src/survey/scene.js';
import { computeStats } from '../src/parts/assembly.js';

describe('survey scene', () => {
  it('projects the ground at about 60° and shortens cliffs', () => {
    const elev = (CAMERA_ELEVATION_DEG * Math.PI) / 180;
    expect(CAMERA_ELEVATION_DEG).toBe(60);
    expect(TILE_H / TILE_W).toBeCloseTo(Math.sin(elev), 1);
    expect(TILE_Z / (TILE_W / 2)).toBeCloseTo(Math.cos(elev), 2);
    expect(TILE_H).toBeGreaterThan(TILE_W / 2);
    expect(TILE_Z).toBeLessThan(14);
  });

  it('fits a scanner and a laser on the survey rover', () => {
    const stats = computeStats(surveySpec());
    expect(stats.problems).toEqual([]);
    expect(stats.scanRadius).toBeGreaterThan(0);
    expect(stats.miningPower).toBeGreaterThan(0);
    expect(surveySpec().color.toLowerCase()).not.toMatch(/ff[89a-f]|e8b|ffb/);
  });

  it('reports a crystal in range and a stand beside it', () => {
    const sim = new Simulation({
      body: defaultSurveyBody(),
      spec: surveySpec(),
      events: new EventBus(),
    });
    const stand = formationStand(sim);
    expect(stand).not.toBeNull();
    sim.rover.pos = { x: stand!.x, y: stand!.y };
    sim.rover.facing = stand!.facing;
    const snap = surveySnapshot(sim);
    expect(snap.formationInRange).toBe(true);
    expect(snap.nearestFormation).not.toBeNull();
    expect(snap.clock).toMatch(/^\d{2}:\d{2}$/);
    expect(snap.fuelLabel.startsWith('F')).toBe(true);
    expect(SURVEY_CHROME.primary.id).toBe('scan');
    expect(SURVEY_CHROME.secondary.map((a) => a.id)).toEqual(['scan', 'hub', 'laser']);
  });
});
