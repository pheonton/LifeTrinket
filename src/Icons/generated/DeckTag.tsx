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
        width={23}
        height={31}
        x={4}
        y={12}
        fill="currentColor"
        fillOpacity={0.4}
        rx={3}
        transform="rotate(-15 15.5 27.5)"
      />
      <rect width={24} height={35} x={22} y={8} fill="currentColor" rx={3} />
    </svg>
  );
};
DeckTag.propTypes = {
  title: PropTypes.string,
};
export default DeckTag;
