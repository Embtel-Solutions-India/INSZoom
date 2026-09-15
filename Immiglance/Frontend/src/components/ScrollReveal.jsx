import { useEffect, useRef, useState } from "react";

/**
 * ScrollReveal - Component that reveals content when it enters the viewport
 * Supports fade-in and slide-up animations
 */
export default function ScrollReveal({ 
  children, 
  className = "", 
  delay = 0,
  duration = 600,
  distance = 20,
  direction = "up" 
}) {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => setIsVisible(true), delay);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -50px 0px" }
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [delay]);

  const getTransform = () => {
    if (!isVisible) {
      if (direction === "up") return `translateY(${distance}px)`;
      if (direction === "down") return `translateY(-${distance}px)`;
      if (direction === "left") return `translateX(${distance}px)`;
      if (direction === "right") return `translateX(-${distance}px)`;
    }
    return "translate(0, 0)";
  };

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: getTransform(),
        transition: `opacity ${duration}ms ease-out, transform ${duration}ms ease-out`,
      }}
    >
      {children}
    </div>
  );
}
