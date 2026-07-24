import React from 'react';
import { useFullpageSections } from '../hooks/useFullpageSections';
import '../styles/fullpage.css';
import './About.css';

const TOTAL_SECTIONS = 3;

const About = () => {
    const { sectionStyle, handleTouchStart, handleTouchEnd, floatingLogoPortal } = useFullpageSections(TOTAL_SECTIONS);

    return (
        <>
        {floatingLogoPortal}
        <div
            className="fp-page"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {/* Section 0 — Our Design */}
            <section className="fp-section ab-design" style={{ ...sectionStyle(0), zIndex: 1 }}>
                <div className="ab-design-inner">
                    <h2 className="ab-design-heading">Our Design</h2>
                    <div className="ab-design-image">
                        <img src="/about-our-design.jpg" alt="Hands hand-stitching a garment seam" loading="lazy" />
                    </div>
                    <p className="ab-design-copy">
                        MORBEI creates timeless clothing with a focus on proportion, fit, and craftsmanship.
                        Every design is shaped with balance in mind, where nothing feels unnecessary and
                        nothing feels overdone.
                    </p>
                </div>
            </section>

            {/* Section 1 — Our Craft */}
            <section className="fp-section ab-design" style={{ ...sectionStyle(1), zIndex: 2 }}>
                <div className="ab-design-inner">
                    <h2 className="ab-design-heading">Our Craft</h2>
                    <div className="ab-design-image">
                        {/* TODO: source photo has a visible "Saint Laurent Paris" garment
                            label — placeholder from Figma per request, swap before this
                            page is considered final. */}
                        <img src="/about-our-craft.jpg" alt="Hands finishing a garment seam" loading="lazy" />
                    </div>
                    <p className="ab-design-copy">
                        Every piece is crafted in our atelier and undergoes multiple fittings and quality
                        checks before it reaches you. Our approach is guided by precision, attention to
                        detail, and a commitment to making garments that you will enjoy wearing.
                    </p>
                </div>
            </section>

            {/* Section 2 — Our Standards */}
            <section className="fp-section ab-design" style={{ ...sectionStyle(2), zIndex: 3 }}>
                <div className="ab-design-inner">
                    <h2 className="ab-design-heading">Our Standards</h2>
                    <div className="ab-design-image">
                        {/* TODO: source photo shows a large "Saint Laurent" hanger/tag —
                            placeholder from Figma per request, swap before this page is
                            considered final. */}
                        <img src="/about-our-standards.jpg" alt="A finished garment on a hanger" loading="lazy" />
                    </div>
                    <p className="ab-design-copy">
                        Honesty is central to MORBEI. What you see is what you get. We choose our fabrics
                        with care and make every piece to the same standard from the first sample to the
                        final garment.
                    </p>
                </div>
            </section>
        </div>
        </>
    );
};

export default About;
