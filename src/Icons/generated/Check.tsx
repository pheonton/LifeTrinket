import PropTypes from 'prop-types';
import { SVGProps } from 'react';
interface SVGRProps {
  title?: string;
  titleId?: string;
  size?: string;
}
const Check = ({
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
        fillRule="evenodd"
        d="M26 48c12.15 0 22-9.85 22-22S38.15 4 26 4 4 13.85 4 26s9.85 22 22 22m0 4c14.36 0 26-11.64 26-26S40.36 0 26 0 0 11.64 0 26s11.64 26 26 26"
        clipRule="evenodd"
      />
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={4.5}
        d="m16 26.5 6.5 6.5L36 19"
      />
    </svg>
  );
};
Check.propTypes = {
  title: PropTypes.string,
};
export default Check;
