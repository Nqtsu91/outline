type Props = {
  /** The size of the icon, 24px is default to match standard icons */
  size?: number;
  /** The color of the icon, defaults to the current text color */
  color?: string;
};

/**
 * Icon representing subscript formatting, e.g. the "2" in x₂.
 */
export default function SubscriptIcon({
  size = 24,
  color = "currentColor",
  ...rest
}: Props) {
  return (
    <svg
      fill={color}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      version="1.1"
      {...rest}
    >
      <text
        x="3"
        y="16"
        fontSize="12"
        fontFamily="inherit"
        fontWeight="600"
        fill={color}
      >
        x
      </text>
      <text
        x="12"
        y="20"
        fontSize="8"
        fontFamily="inherit"
        fontWeight="600"
        fill={color}
      >
        2
      </text>
    </svg>
  );
}
