import { describe, it, expect, vi } from 'vitest';
import {
  encodeTrackLink,
  decodeTrackLink,
  getTrackLinkFromUrl,
  clearTrackLinkFromUrl,
} from './trackLink';
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

  it('accepts 6 seats', () => {
    const sixSeats: TrackLink = {
      ...link,
      seats: ['A', 'B', 'C', 'D', 'E', 'F'],
    };
    expect(decodeTrackLink(encodeTrackLink(sixSeats))).toEqual(sixSeats);
  });

  it('returns null for 7 seats', () => {
    const bad = encodeTrackLink({
      ...link,
      seats: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    } as TrackLink);
    expect(decodeTrackLink(bad)).toBeNull();
  });

  it('accepts a label of exactly 64 characters', () => {
    const maxLabel: TrackLink = { ...link, label: 'x'.repeat(64) };
    expect(decodeTrackLink(encodeTrackLink(maxLabel))).toEqual(maxLabel);
  });

  it('returns null for a label of 65 characters', () => {
    const bad = encodeTrackLink({
      ...link,
      label: 'x'.repeat(65),
    } as TrackLink);
    expect(decodeTrackLink(bad)).toBeNull();
  });

  it('returns null for a non-positive life', () => {
    const bad = encodeTrackLink({ ...link, life: 0 } as TrackLink);
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

describe('clearTrackLinkFromUrl', () => {
  it('clears a track hash, replacing the URL with just path and search', () => {
    const replaceState = vi.fn();
    clearTrackLinkFromUrl(
      { hash: '#track=xyz', pathname: '/app', search: '?foo=bar' },
      { replaceState }
    );
    expect(replaceState).toHaveBeenCalledWith(null, '', '/app?foo=bar');
  });

  it('leaves a game hash alone', () => {
    const replaceState = vi.fn();
    clearTrackLinkFromUrl(
      { hash: '#game=abc', pathname: '/app', search: '' },
      { replaceState }
    );
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('leaves an empty hash alone', () => {
    const replaceState = vi.fn();
    clearTrackLinkFromUrl(
      { hash: '', pathname: '/app', search: '' },
      { replaceState }
    );
    expect(replaceState).not.toHaveBeenCalled();
  });
});
