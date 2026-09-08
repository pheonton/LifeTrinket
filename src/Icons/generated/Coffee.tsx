import PropTypes from 'prop-types';
import { SVGProps } from 'react';
interface SVGRProps {
  title?: string;
  titleId?: string;
  size?: string;
}
const Coffee = ({
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
      <path
        fill="currentColor"
        d="M8 22h27v10c0 7.18-5.82 13-13 13h-1c-7.18 0-13-5.82-13-13z"
      />
      <path
        stroke="currentColor"
        strokeWidth={3.542}
        d="M33.119 24.786h3.099a5.755 5.755 0 0 1 0 11.51h-3.1"
      />
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth={3.5}
        d="M13.79 8.494c-2.5 3.2 2.5 5.3 0 8.5m7.5-9.5c-2.5 3.2 2.5 5.3 0 8.5m7.5-7.5c-2.5 3.2 2.5 5.3 0 8.5"
      />
    </svg>
  );
};
Coffee.propTypes = {
  title: PropTypes.string,
};
export default Coffee;
