import React, { useState } from 'react';
import { MapPin } from 'lucide-react';

interface PlaceImageProps {
  src?: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const PlaceImage: React.FC<PlaceImageProps> = ({ src, alt = '', className, style }) => {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`img-placeholder${className ? ' ' + className : ''}`}
        role="img"
        aria-label={alt}
        style={style}
      >
        <MapPin className="img-placeholder-icon" />
        <span>No original photo yet</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
};