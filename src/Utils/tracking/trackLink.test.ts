import { describe, it, expect } from 'vitest';
import { encodeTrackLink, decodeTrackLink, getTrackLinkFromUrl } from './trackLink';
import type { TrackLink } from '../../Types/Tracking';

const link: TrackLink = {
  v: 1,
  id: 'AAAAAAAAAABBBBBBBBBB',
  seats: ['Alice', 'Bob'],
  life: 20,
  label: 'Round 2 · Table 3',
};

describe('encodeTrackLink and decodeTrackLink', () => {
  it('round-trips a link', () => {
    expect(decodeTrackLink(encodeTrackLink(link))).toEqual(link);
  });

  it('round-trips a link without the optional fields', () => {
    const minimal: TrackLink = { v: 1, id: link.id, seats: ['Alice', 'Bob'] };
    expect(decodeTrackLink(encodeTrackLink(minimal))).toEqual(minimal);
  });

  it('returns null for rubbish instead of throwing', () => {
    expect(decodeTrackLink('not-compressed')).toBeNull();
  });

  it('returns null for an id of the wrong length', () => {
    const bad = encodeTrackLink({ ...link, id: 'short' } as TrackLink);
    expect(decodeTrackLink(bad)).toBeNull();
  });

  it('returns null for a single seat', () => {
    const bad = encodeTrackLink({ ...link, seats: ['Alice'] } as TrackLink);
    expect(decodeTrackLink(bad)).toBeNull();
  });
});

describe('getTrackLinkFromUrl', () => {
  it('reads a track hash', () => {
    expect(getTrackLinkFromUrl(`#track=${encodeTrackLink(link)}`)).toEqual(link);
  });

  it('ignores the existing game hash', () => {
    expect(getTrackLinkFromUrl('#game=abc')).toBeNull();
  });

  it('ignores an empty hash', () => {
    expect(getTrackLinkFromUrl('')).toBeNull();
  });
});
