import * as React from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { s } from "@shared/styles";

type Props = {
  /** The image URL to preview. */
  image: string;
  /** The page title shown above the image. */
  title: string;
  /** Viewport coordinates for the top-left of the card. */
  top: number;
  left: number;
};

/**
 * A small floating card rendered in a portal that shows a page's designated
 * hover image with its title above it. Positioned next to the sidebar row.
 */
export default function SidebarHoverImagePreview({
  image,
  title,
  top,
  left,
}: Props) {
  return createPortal(
    <Card style={{ top, left }} role="tooltip">
      {title ? <Title>{title}</Title> : null}
      <Image src={image} alt={title} draggable={false} />
    </Card>,
    window.document.body
  );
}

const Card = styled.div`
  position: fixed;
  z-index: 1000;
  max-width: 280px;
  padding: 8px;
  background: ${s("menuBackground")};
  border-radius: 8px;
  box-shadow: ${s("menuShadow")};
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Title = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${s("text")};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Image = styled.img`
  display: block;
  max-width: 264px;
  max-height: 200px;
  width: auto;
  height: auto;
  border-radius: 4px;
  object-fit: cover;
`;
