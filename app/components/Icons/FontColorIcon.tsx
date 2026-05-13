type Props = {
  /** The size of the icon, 24px is default to match standard icons */
  size?: number;
  /** The color of the letter A, defaults to the current text color */
  color?: string;
  /** The color of the bar underneath the letter, defaults to color */
  barColor?: string;
  /** If true, the icon will retain its color in selected menus and other places that attempt to override it */
  retainColor?: boolean;
};

export default function FontColorIcon({
  size = 24,
  color = "currentColor",
  barColor,
  retainColor,
}: Props) {
  const bar = barColor || color;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5 18L12 4L19 18M8 13H16"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={retainColor ? { stroke: color } : undefined}
      />
      <rect
        x="3"
        y="20.5"
        width="18"
        height="2"
        rx="1"
        fill={bar}
        style={retainColor ? { fill: bar } : undefined}
      />
    </svg>
  );
}
