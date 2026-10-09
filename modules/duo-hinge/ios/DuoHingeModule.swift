import ExpoModulesCore
import UIKit

/// The hinge of a folding iPhone, read with `UIHingeInteraction` (iOS 27.1).
///
/// It's read by a view, `HingeView`, which carries the interaction and sends `onHinge` with the
/// angle in radians (0 shut, π flat) and the status. Being a view on screen, it's always in the
/// hierarchy that's showing, folded or unfolded. On anything older, or a phone that doesn't fold,
/// it never sends.
public final class DuoHingeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DuoHinge")

    Constant("supported") { () -> Bool in
      #if compiler(>=6.3)
      if #available(iOS 27.1, *) { return true }
      #endif
      return false
    }

    View(HingeView.self) {
      Events("onHinge")
    }
  }
}

public final class HingeView: ExpoView {
  let onHinge = EventDispatcher()
  private var interaction: AnyObject?
  private var lastAngle: Double = -1
  private var lastStatus = ""

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    backgroundColor = .clear
    #if compiler(>=6.3)
    if #available(iOS 27.1, *) {
      let hinge = UIHingeInteraction { [weak self] _, update in
        guard let self, let state = update.hinge else { return }
        let angle = Double(state.angle)
        let status = Self.name(state.status)
        if angle == self.lastAngle && status == self.lastStatus { return }
        self.lastAngle = angle
        self.lastStatus = status
        self.onHinge(["angle": angle, "status": status])
      }
      addInteraction(hinge)
      interaction = hinge
    }
    #endif
  }

  #if compiler(>=6.3)
  @available(iOS 27.1, *)
  private static func name(_ status: UIHinge.Status) -> String {
    switch status {
    case .closed: return "closed"
    case .partiallyOpen: return "partiallyOpen"
    case .fullyOpen: return "fullyOpen"
    default: return "unknown"
    }
  }
  #endif
}
