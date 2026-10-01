import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

export default function SpringCard() {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const pressed = useSharedValue(0);

  const pan = Gesture.Pan()
    .onBegin(() => {
      pressed.value = withSpring(1);
    })
    .onChange((event) => {
      x.value += event.changeX;
      y.value += event.changeY;
    })
    .onFinalize(() => {
      x.value = withSpring(0);
      y.value = withSpring(0);
      pressed.value = withSpring(0);
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { rotate: `${interpolate(x.value, [-200, 200], [-12, 12])}deg` },
      { scale: interpolate(pressed.value, [0, 1], [1, 1.05]) },
    ],
  }));

  return (
    <View style={styles.container}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.card, cardStyle]}>
          <Text style={styles.title}>Drag me</Text>
          <Text style={styles.subtitle}>Reanimated + Gesture Handler</Text>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0E0F13',
  },
  card: {
    width: 260,
    height: 360,
    borderRadius: 28,
    padding: 24,
    justifyContent: 'flex-end',
    backgroundColor: '#3C87F7',
    boxShadow: '0 20px 40px rgba(60, 135, 247, 0.35)',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: 700,
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: 14,
    marginTop: 4,
  },
});
