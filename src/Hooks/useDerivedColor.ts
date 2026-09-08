import { useEffect, useState } from 'react';
import { getCachedImageColor, sampleImageColor } from '../Utils/imageColor';

/**
 * The representative colour of an image URL (see Utils/imageColor). Derived
 * from the shared cache during render; the effect only kicks off the sample.
 * Returns null while unknown or if sampling failed.
 */
export const useDerivedColor = (url: string | null | undefined): string | null => {
  const [, force] = useState(0);

  useEffect(() => {
    if (!url || getCachedImageColor(url) !== undefined) {
      return;
    }
    let alive = true;
    sampleImageColor(url).then(() => {
      if (alive) force((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [url]);

  return url ? getCachedImageColor(url) ?? null : null;
};
