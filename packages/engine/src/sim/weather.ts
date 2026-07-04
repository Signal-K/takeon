import type { WeatherType } from '../types.js';

/** Display metadata + tuning for weather events. */
export const WEATHER_INFO: Record<
  WeatherType,
  { name: string; icon: string; minDuration: number; maxDuration: number; warning: string }
> = {
  'dust-devil': {
    name: 'Dust devil',
    icon: '🌪',
    minDuration: 28,
    maxDuration: 50,
    warning: 'A dust devil is wandering nearby — it scours solar panels and batters the hull.',
  },
  'dust-storm': {
    name: 'Dust storm',
    icon: '🌫',
    minDuration: 45,
    maxDuration: 90,
    warning: 'Global dust storm: solar output collapses and driving costs more.',
  },
  'solar-storm': {
    name: 'Solar storm',
    icon: '☀⚡',
    minDuration: 30,
    maxDuration: 60,
    warning: 'Radiation surge: electronics drain the battery and instruments cost double.',
  },
  'meteor-shower': {
    name: 'Meteor shower',
    icon: '☄',
    minDuration: 18,
    maxDuration: 34,
    warning: 'Incoming impactors — keep moving and stay clear of strikes.',
  },
  'cryo-fog': {
    name: 'Sublimation fog',
    icon: '❄',
    minDuration: 45,
    maxDuration: 95,
    warning: 'Sublimating ice hazes the surface; the sun dims behind the fog.',
  },
};
