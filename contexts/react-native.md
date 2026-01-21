# React Native Development Context

> Context for mobile applications with React Native and Expo.

---

## Behavioral Mode

**Mobile-first, performance-aware, platform-respectful.**

- Expo SDK for managed features, eject only when necessary
- Respect platform conventions (iOS HIG, Material Design)
- 60fps is the target - use native driver for animations
- Test on real devices, not just simulators

---

## Priorities (Ordered)

1. **Stability** - No crashes, graceful error handling
2. **Performance** - Smooth scrolling, fast interactions
3. **Platform Feel** - iOS feels iOS, Android feels Android
4. **Offline Support** - Handle network failures gracefully
5. **Bundle Size** - Users care about app size

---

## Project Structure

```
app/                    # Expo Router screens
├── (tabs)/
│   ├── _layout.tsx     # Tab navigator
│   ├── index.tsx       # Home tab
│   └── profile.tsx     # Profile tab
├── (auth)/
│   └── login.tsx
├── _layout.tsx         # Root layout
└── +not-found.tsx
components/
├── ui/                 # Reusable primitives
└── [feature]/          # Feature components
lib/
├── api/                # API clients
├── hooks/              # Custom hooks
└── stores/             # State management
```

---

## Navigation (Expo Router)

```tsx
// app/_layout.tsx
import { Stack } from 'expo-router'

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
    </Stack>
  )
}

// Navigation
import { useRouter, Link } from 'expo-router'

const router = useRouter()
router.push('/profile/123')
router.replace('/home')
router.back()

<Link href="/settings">Settings</Link>
```

---

## Platform-Specific Code

```tsx
// File-based
Button.tsx           // Default
Button.ios.tsx       // iOS override
Button.android.tsx   // Android override

// Inline
import { Platform } from 'react-native'

const styles = StyleSheet.create({
  shadow: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
    },
    android: {
      elevation: 4,
    },
  }),
})
```

---

## Gotchas & Pitfalls

| Pitfall | Fix |
|---------|-----|
| FlatList slow with many items | Use `@shopify/flash-list` |
| Animations janky | Use `react-native-reanimated` with native driver |
| Keyboard covers input | Use `KeyboardAvoidingView` or `react-native-keyboard-aware-scroll-view` |
| `ScrollView` inside `FlatList` | Never nest scrollables - use `ListHeaderComponent` |
| Text not showing on Android | Wrap in `<Text>` - no raw strings |
| Image not loading | Check `expo-image` and proper URI |
| Safe area overlap | Use `react-native-safe-area-context` |
| Touch target too small | Minimum 44x44 points |
| Slow re-renders | Memoize list items, check `keyExtractor` |

---

## Performance Patterns

### Lists
```tsx
// Use FlashList for large lists
import { FlashList } from '@shopify/flash-list'

<FlashList
  data={items}
  renderItem={({ item }) => <Item {...item} />}
  estimatedItemSize={80}
  keyExtractor={(item) => item.id}
/>
```

### Animations
```tsx
// Always use native driver when possible
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring
} from 'react-native-reanimated'

function AnimatedBox() {
  const scale = useSharedValue(1)

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  const onPress = () => {
    scale.value = withSpring(1.2)
  }

  return (
    <Pressable onPress={onPress}>
      <Animated.View style={[styles.box, animatedStyle]} />
    </Pressable>
  )
}
```

### Images
```tsx
import { Image } from 'expo-image'

<Image
  source={uri}
  style={{ width: 100, height: 100 }}
  contentFit="cover"
  placeholder={blurhash}
  transition={200}
/>
```

---

## Data Fetching

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

function Profile({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => api.getUser(userId),
  })

  if (isLoading) return <ActivityIndicator />
  return <ProfileView user={data} />
}

function UpdateButton() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: api.updateProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user'] })
    },
  })

  return (
    <Button
      onPress={() => mutation.mutate(data)}
      disabled={mutation.isPending}
    />
  )
}
```

---

## Safe Areas

```tsx
import { SafeAreaView } from 'react-native-safe-area-context'

function Screen() {
  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
      <Content />
    </SafeAreaView>
  )
}

// Or with hooks
import { useSafeAreaInsets } from 'react-native-safe-area-context'

function Header() {
  const insets = useSafeAreaInsets()
  return (
    <View style={{ paddingTop: insets.top }}>
      <HeaderContent />
    </View>
  )
}
```

---

## Expo SDK Modules

```tsx
// Secure storage
import * as SecureStore from 'expo-secure-store'
await SecureStore.setItemAsync('token', value)

// Camera
import { CameraView, useCameraPermissions } from 'expo-camera'

// Location
import * as Location from 'expo-location'
const location = await Location.getCurrentPositionAsync()

// Haptics
import * as Haptics from 'expo-haptics'
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)

// Notifications
import * as Notifications from 'expo-notifications'
```

---

## Development Commands

```bash
# Start development
npx expo start

# Run on specific platform
npx expo run:ios
npx expo run:android

# Build for production (EAS)
eas build --platform ios
eas build --platform android

# Submit to stores
eas submit --platform ios
eas submit --platform android

# Update OTA
eas update --branch production
```

---

## Documentation Sources

- **Expo**: [docs.expo.dev](https://docs.expo.dev)
- **Expo Router**: [docs.expo.dev/router](https://docs.expo.dev/router/introduction/)
- **React Native**: [reactnative.dev](https://reactnative.dev)
- **Reanimated**: [docs.swmansion.com/react-native-reanimated](https://docs.swmansion.com/react-native-reanimated/)
- **FlashList**: [shopify.github.io/flash-list](https://shopify.github.io/flash-list/)

---

## Pre-Implementation Checklist

- [ ] Using Expo SDK features where available
- [ ] Platform-specific code for iOS/Android differences
- [ ] Safe areas handled for all screens
- [ ] Animations use native driver / Reanimated
- [ ] Lists use FlashList for performance
- [ ] Touch targets minimum 44x44 points
- [ ] Handles offline/error states
- [ ] Tested on real devices (not just simulator)
