import PropTypes from 'prop-types';
import { SVGProps } from 'react';
interface SVGRProps {
  title?: string;
  titleId?: string;
  size?: string;
}
const DeckTag = ({
  title,
  titleId,
  ...props
}: SVGProps<SVGSVGElement> & SVGRProps) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={props.size || 16}
      height={props.size || 16}
      fill="none"
      viewBox="0 0 52 52"
      aria-labelledby={titleId}
      {...props}
    >
      {title ? <title id={titleId}>{title}</title> : null}
      <rect
        width={25.12}
        height={33.857}
        x={-3.145}
        y={12.416}
        fill="currentColor"
        fillOpacity={0.4}
        rx={3.276}
        style={{
          strokeWidth: 1.09215,
        }}
        transform="rotate(-15)"
      />
      <path
        fill="currentColor"
        d="M27.064 4.611a3.267 3.267 0 0 0-3.275 3.276V39.56a3.267 3.267 0 0 0 3.275 3.275h19.659A3.27 3.27 0 0 0 50 39.56V7.887a3.27 3.27 0 0 0-3.277-3.276zm14.772 2.186.004 1.484-4.856 4.358 4.87-.016.003 1.13-9.447.03-.004-1.129 4.49-.015-4.503-4.246-.004-1.39 4.478 4.308zm-8.957 8.808.846.325a6.9 6.9 0 0 0-.428 2.343c.007 2.274 1.414 3.645 3.715 3.637 2.41-.008 4.009-1.512 4.002-3.771a6.4 6.4 0 0 0-.442-2.244l.828-.262a6.9 6.9 0 0 1 .61 2.762c.009 2.79-1.891 4.662-4.737 4.671-2.967.01-4.96-1.93-4.97-4.857-.003-.926.21-1.908.576-2.604m9.014 8.944.02 5.935-9.448.03-.02-5.936.98-.002.016 4.805 3.09-.01-.013-4.437.978-.004.016 4.437 3.416-.01-.016-4.806zm-4.875 7.937c3.035-.01 4.906 1.933 4.916 4.791l.01 2.885-9.448.031-.01-3.09c-.009-2.885 1.673-4.607 4.532-4.617m.181 1.159c-2.396.007-3.74 1.29-3.732 3.591l.006 1.825 7.486-.026-.006-1.89c-.007-2.247-1.371-3.508-3.754-3.5"
        style={{
          strokeWidth: 1.09215,
        }}
      />
    </svg>
  );
};
DeckTag.propTypes = {
  title: PropTypes.string,
};
export default DeckTag;
