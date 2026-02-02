from dataclasses import dataclass


@dataclass
class VLLMResolutionProfile:
    """
    The implicit coordinate-space in which the VLLM produces predictions.
    These values come from empirical testing.
    """

    canonical_width: float = 1000.0
    canonical_height: float = 1000.0

    # Optional smoothing factors if needed later
    clamp: bool = True


class VLLMCoordinateMapper:
    """
    Converts between the VLLM's canonical coordinate space (x_pred, y_pred)
    and real pixel coordinates inside the actual screenshot coordinate system.
    """

    def __init__(self, profile: VLLMResolutionProfile = VLLMResolutionProfile()):
        self.prof = profile

    def normalize(self, x_pred: float, y_pred: float):
        """
        Convert model's coordinates => relative position in its canonical space.
        """
        rx = x_pred / self.prof.canonical_width
        ry = y_pred / self.prof.canonical_height

        # Optionally clamp extremely invalid predictions
        if self.prof.clamp:
            rx = max(0.0, min(1.0, rx))
            ry = max(0.0, min(1.0, ry))

        return rx, ry

    def map_to_real(
        self, x_pred: float, y_pred: float, real_width: int, real_height: int
    ):
        """
        Convert VLLM raw outputs to real coordinates.
        """
        rx, ry = self.normalize(x_pred, y_pred)

        real_x = rx * real_width
        real_y = ry * real_height

        # Clamp final coords just to be safe
        real_x = max(0, min(real_width - 1, int(round(real_x))))
        real_y = max(0, min(real_height - 1, int(round(real_y))))

        return real_x, real_y

    def __call__(self, x_pred, y_pred, real_width, real_height):
        return self.map_to_real(x_pred, y_pred, real_width, real_height)
