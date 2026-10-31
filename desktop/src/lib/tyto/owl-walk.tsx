/**
 * The walking owl of the first-run screen: a geometric owl in profile walks left and right along a
 * 56 px strip and turns round at each edge (shapes from design/tyto/owl-walk-right.svg, the owner's
 * drawing). The body is `currentColor` with the eye cut out, so it follows the theme like OwlMark.
 *
 * All motion is CSS in theme.css (`.tyto-owl-walk*`, transform only). `walking={false}` stops the
 * steps and the bob and holds the owl where it is; under reduced motion it stands still in the middle.
 */
export function OwlWalk({ walking }: { walking: boolean }) {
	return (
		<div className="tyto-owl-walk" data-walking={walking} data-testid="owl-walk" aria-hidden="true">
			<div className="tyto-owl-walk-track">
				<div className="tyto-owl-walk-mover">
					<svg className="tyto-owl-walk-owl" viewBox="205 140 600 720" width="40" height="48" fill="currentColor">
						<g className="tyto-owl-walk-foot tyto-owl-walk-foot-back">
							<path d="M462 760 L462 798 L490 798 L490 760 Z" />
							<path d="M428 844 C428 814 446 796 476 796 C506 796 522 814 522 844 Z" />
						</g>
						<g className="tyto-owl-walk-foot tyto-owl-walk-foot-front">
							<path d="M542 758 L555 802 L584 796 L568 750 Z" />
							<path d="M535 844 C535 814 552 796 582 796 C612 796 629 814 629 844 Z" />
						</g>
						<g className="tyto-owl-walk-body">
							{/* Body with the eye as an even-odd hole, then the pupil. */}
							<path
								fillRule="evenodd"
								d="M382 156 L480 226 C605 220 712 308 730 442 C762 454 780 478 784 514 C766 508 750 504 735 503 C748 666 648 796 485 804 L365 804 C458 766 516 688 525 588 C510 694 442 782 325 804 L225 804 L268 584 L268 446 C268 352 315 284 382 252 Z M685 434 A90 90 0 1 0 505 434 A90 90 0 1 0 685 434 Z"
							/>
							<circle cx="595" cy="434" r="44" />
						</g>
					</svg>
				</div>
			</div>
		</div>
	)
}
